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
const transaction = '2'.repeat(88);

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
            return transaction;
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
        assert.equal(result.verified, true);
        assert.equal(result.transaction, transaction);
        assert.strictEqual(result.contractHash, proof.contractHash);
        assert.equal(result.identityRevealed, false);
        assert.equal(result.dataTransmitted, false);
        assert.equal(result.state, undefined, 'the submission API does not promise a separate status fetch');
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

test('Node deriveKey returns its documented hex key and sketch object', () => {
    const sdk = loadModule('sdk/index.js', { './lib/anchor_integration': {} });
    const { key, sketch } = sdk.deriveKey(features);
    assert.match(key, /^[0-9a-f]{64}$/);
    assert.match(sketch, /^[0-9a-f]{40}$/);
    assert.equal(sdkRequire('./lib/fuzzyExtractor').reproduce(features, sketch), key);
});

test('SDK rejects invalid multisig settings and contract data before registration', async () => {
    const calls = [];
    const sdk = loadModule('sdk/index.js', {
        './lib/anchor_integration': {
            registerContract: async () => { calls.push('register'); },
            createMultisig: async () => { calls.push('create'); },
        },
    });
    for (const args of [[0, 3], [2.5, 3], [2, 1], [1, 256], ['2', 3]]) {
        await assert.rejects(sdk.createMultiSigContract(contract, ...args), /integer values/);
    }
    await assert.rejects(sdk.createMultiSigContract({ text: contract }, 2, 3), /string or Uint8Array/);
    assert.deepEqual(calls, []);
});

test('SDK creation preserves the address, receipt, settings and exact string or binary hash', async () => {
    for (const contractData of [contract, Uint8Array.from([0, 255, 128, 1])]) {
        for (const tx of [transaction, null]) {
            const hashes = [];
            const sdk = loadModule('sdk/index.js', {
                './lib/anchor_integration': {
                    registerContract: async hash => { hashes.push(Array.from(hash)); },
                    createMultisig: async (hash, threshold, maxSigners) => {
                        hashes.push(Array.from(hash));
                        assert.equal(threshold, 2);
                        assert.equal(maxSigners, 3);
                        return { multisigPda: { toString: () => 'test-multisig-address' }, tx };
                    },
                },
            });
            const result = await sdk.createMultiSigContract(contractData, 2, 3);
            const expected = Array.from(crypto.createHash('sha256').update(contractData).digest());
            assert.deepEqual(hashes, [expected, expected]);
            assert.deepEqual(Array.from(result.contractHash), expected);
            assert.equal(result.multisigAddress, 'test-multisig-address');
            assert.equal(result.transaction, tx);
            assert.equal(result.threshold, 2);
            assert.equal(result.maxSigners, 3);
        }
    }
});

test('SDK finalization preserves both real and already-finalized receipts', async () => {
    for (const tx of [transaction, null]) {
        const sdk = loadModule('sdk/index.js', {
            './lib/anchor_integration': { finalizeMultisig: async hash => {
                assert.equal(hash.length, 32);
                return tx;
            } },
        });
        const result = await sdk.finalizeMultiSigContract(new Uint8Array([0, 255]));
        assert.equal(result.finalized, true);
        assert.equal(result.identityRevealed, false);
        assert.equal(result.transaction, tx);
    }
});

test('one-shot proof CLI releases cached workers on success and failure', async () => {
    const source = fs.readFileSync(path.join(root, 'sdk/scripts/check-proof.js'), 'utf8');
    for (const failure of [false, true]) {
        let terminated = 0;
        const process = {};
        const messages = [];
        const context = vm.createContext({
            require: () => ({ generateIntentProof: async () => {
                if (failure) throw new Error('proving unavailable');
                return { publicInputs: Array(128).fill(0) };
            } }),
            curve_bn128: { terminate: async () => { terminated++; } },
            process,
            console: { log: text => messages.push(text), error: text => messages.push(text) },
        });
        await vm.runInContext(source, context);
        assert.equal(terminated, 1);
        assert.equal(process.exitCode, failure ? 1 : undefined);
        assert.match(messages.join('\n'), failure ? /proving unavailable/ : /PASS/);
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
