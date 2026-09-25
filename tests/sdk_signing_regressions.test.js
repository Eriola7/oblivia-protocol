const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');

const root = path.join(__dirname, '..');
const sdkRequire = createRequire(path.join(root, 'sdk/index.js'));
const features = Array(20).fill(0.5);
const contract = 'SDK regression: Pay 10% — agreement 📝';

// Load the real public entry points with only their network boundary replaced.
// Browser modules intentionally have no Buffer global or polyfill.
function loadModule(relativePath, overrides = {}, globals = {}) {
    const filename = path.join(root, relativePath);
    const nativeRequire = createRequire(filename);
    const context = vm.createContext({
        module: { exports: {} },
        require: name => Object.hasOwn(overrides, name) ? overrides[name] : nativeRequire(name),
        TextEncoder,
        Uint8Array,
        crypto: crypto.webcrypto,
        ...globals,
    });
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
    return context.module.exports;
}

function fakeProof() {
    return {
        contractHash: Array(32).fill(1),
        keyCommitment: Array(32).fill(2),
        signatureCommitment: Array(32).fill(3),
        proofA: Array(64).fill(4),
        proofB: Array(128).fill(5),
        proofC: Array(64).fill(6),
        publicInputs: Array(128).fill(7),
    };
}

for (const method of ['signContract', 'signMultiSig']) {
    test(`public SDK ${method} submits the complete flat proof result`, async () => {
        const proof = fakeProof();
        const calls = [];
        const extractor = sdkRequire('./lib/fuzzyExtractor');
        const expectedScalar = BigInt('0x' + extractor.generate(features).key.slice(0, 32));
        const submit = async (hash, submitted) => {
            assert.strictEqual(submitted, proof);
            assert.strictEqual(hash, proof.contractHash);
            calls.push('submit');
        };
        const sdk = loadModule('sdk/index.js', {
            './lib/groth16_intent': {
                generateIntentProof: async (scalar, text) => {
                    assert.equal(scalar, expectedScalar);
                    assert.equal(text, contract);
                    calls.push('prove');
                    return proof;
                },
            },
            './lib/anchor_integration': {
                registerContract: async hash => {
                    assert.strictEqual(hash, proof.contractHash);
                    calls.push('register');
                },
                submitVerifiedGroth16: submit,
                submitVerifiedMultiSig: submit,
            },
        });
        const result = await sdk[method](features, contract);
        assert.deepEqual(calls, method === 'signContract' ? ['prove', 'register', 'submit'] : ['prove', 'submit']);
        assert.strictEqual(result.keyCommitment, proof.keyCommitment);
        assert.strictEqual(result.signatureCommitment, proof.signatureCommitment);
        if (method === 'signContract') assert.equal(result.verified, true);
    });

    test(`public SDK ${method} propagates proof and submission failures`, async () => {
        const proof = fakeProof();
        let failProving = true;
        const calls = [];
        const submit = async () => { calls.push('submit'); throw new Error('submission rejected'); };
        const sdk = loadModule('sdk/index.js', {
            './lib/groth16_intent': {
                generateIntentProof: async () => {
                    if (failProving) throw new Error('proving unavailable');
                    return proof;
                },
            },
            './lib/anchor_integration': {
                registerContract: async () => { calls.push('register'); },
                submitVerifiedGroth16: submit,
                submitVerifiedMultiSig: submit,
            },
        });
        await assert.rejects(sdk[method](features, contract), /proving unavailable/);
        assert.deepEqual(calls, [], 'a failed proof must not register or submit anything');
        failProving = false;
        await assert.rejects(sdk[method](features, contract), /submission rejected/);
        assert.deepEqual(calls, method === 'signContract' ? ['register', 'submit'] : ['submit']);
    });
}

test('browser fuzzy extractor works without Buffer and preserves key/sketch encoding', () => {
    const nodeExtractor = sdkRequire('./lib/fuzzyExtractor');
    const browserExtractor = loadModule('sdk/lib/fuzzyExtractor.js');
    for (const input of [features, Array.from({ length: 20 }, (_, i) => i / 19)]) {
        const expected = nodeExtractor.generate(input);
        const actual = browserExtractor.generate(input);
        const quantized = input.map(value => Math.round(value * 255));
        const corrected = quantized.map(value => Math.floor(value / 64) * 64);
        const previousKey = crypto.createHash('sha256')
            .update(Buffer.concat([Buffer.from(corrected), Buffer.from('oblivia-v1')]))
            .digest('hex');
        const previousSketch = Buffer.from(quantized.map((value, i) => value ^ corrected[i])).toString('hex');
        assert.equal(actual.key, previousKey);
        assert.equal(actual.sketch, previousSketch);
        assert.equal(actual.key, expected.key);
        assert.equal(actual.sketch, expected.sketch);
        assert.equal(actual.key.length, 64);
        assert.equal(actual.sketch.length, 40);
        assert.equal(browserExtractor.reproduce(input, actual.sketch), expected.key);
    }
});

test('real Node/browser SDK proofs agree on contract hash and signer commitment', { timeout: 120000 }, async () => {
    const extractor = loadModule('sdk/lib/fuzzyExtractor.js');
    const sdk = loadModule('sdk/index.js', {
        './lib/anchor_integration': {}, // No provider, wallet, RPC, or transaction is loaded.
    });
    const browserSdk = loadModule('sdk/browser.js', {
        './lib/fuzzyExtractor': extractor,
    });
    try {
        const nodeProof = await sdk.generateProof(features, contract);
        const browserProof = await browserSdk.generateProof(features, contract, {
            wasmUrl: path.join(root, 'sdk/lib/proving/oblivia.wasm'),
            zkeyUrl: path.join(root, 'sdk/lib/proving/oblivia_1.zkey'),
        });
        assert.equal(nodeProof.publicInputs.length, 128);
        assert.equal(browserProof.publicInputs.length, 4);
        assert.equal(browserProof.verified, true);
        assert.deepEqual(Array.from(browserProof.contractHash), Array.from(nodeProof.contractHash));
        assert.equal(
            BigInt(browserProof.publicInputs[0]),
            BigInt('0x' + Buffer.from(nodeProof.keyCommitment).toString('hex')),
        );
        const nodeSignals = Array.from({ length: 4 }, (_, i) =>
            BigInt('0x' + Buffer.from(nodeProof.publicInputs.slice(i * 32, (i + 1) * 32)).toString('hex')).toString());
        assert.deepEqual(Array.from(browserProof.publicInputs.slice(2)), nodeSignals.slice(2));
        // Signature commitments also include a timestamp, so they need not match.
    } finally {
        // snarkjs caches a worker pool; release it so this offline test exits.
        if (globalThis.curve_bn128) await globalThis.curve_bn128.terminate();
    }
});
