const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const root = path.join(__dirname, '..');
const sdkRequire = createRequire(path.join(root, 'sdk/index.js'));
const valid = Array(20).fill(0.5);
const validationError = /dense array of exactly 20 finite numbers in \[0, 1\]/;

function loadModule(relativePath, overrides = {}, globals = {}) {
    const filename = path.join(root, relativePath);
    const nativeRequire = createRequire(filename);
    const context = vm.createContext({
        module: { exports: {} },
        require: name => Object.hasOwn(overrides, name) ? overrides[name] : nativeRequire(name),
        TextEncoder,
        Uint8Array,
        ...globals,
    });
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
    return context.module.exports;
}

function invalidVectors() {
    const sparse = valid.slice();
    delete sparse[7];
    const inherited = valid.slice();
    delete inherited[7];
    Object.setPrototypeOf(inherited, Object.assign(Object.create(Array.prototype), { 7: 0.5 }));
    return [
        undefined, null, {}, new Float32Array(20), [], Array(19).fill(0.5), Array(21).fill(0.5),
        Array(20), sparse, inherited,
        ...[NaN, Infinity, -Infinity, undefined, null, '0.5', false, -0.01, 1.01].map(value => {
            const vector = valid.slice();
            vector[11] = value;
            return vector;
        }),
    ];
}

const extractors = {
    sdk: sdkRequire('./lib/fuzzyExtractor'),
    browser: loadModule('sdk/lib/fuzzyExtractor.js'), // No Buffer global.
    standalone: loadModule('biometric-entropy-client/fuzzyExtractor.js', {
        // Test the standalone source without relying on its optional install.
        '@noble/hashes/sha2.js': sdkRequire('@noble/hashes/sha2.js'),
    }, { Buffer }),
};

for (const [name, extractor] of Object.entries(extractors)) {
    test(`${name} extractor rejects malformed vectors in every derivation entry point`, () => {
        for (const features of invalidVectors()) {
            assert.throws(() => extractor.quantizeFeatures(features), validationError);
            assert.throws(() => extractor.generate(features), validationError);
            assert.throws(() => extractor.deriveKey(features), validationError);
            assert.throws(() => extractor.reproduce(features, 'unused'), validationError);
            assert.throws(() => extractor.verifyMatch(features, valid), validationError);
            assert.throws(() => extractor.verifyMatch(valid, features), validationError);
        }
    });

    test(`${name} extractor preserves valid boundary values and existing key/sketch bytes`, () => {
        for (const features of [Array(20).fill(0), Array(20).fill(1), valid, Array.from({ length: 20 }, (_, i) => i / 19)]) {
            const quantized = features.map(value => Math.round(value * 255));
            const corrected = quantized.map(value => Math.floor(value / 64) * 64);
            const expectedKey = crypto.createHash('sha256')
                .update(Buffer.concat([Buffer.from(corrected), Buffer.from('oblivia-v1')]))
                .digest('hex');
            const expectedSketch = Buffer.from(quantized.map((value, i) => value ^ corrected[i])).toString('hex');
            const result = extractor.generate(features);
            assert.equal(result.key, expectedKey);
            assert.equal(result.sketch, expectedSketch);
            assert.equal(extractor.reproduce(features, result.sketch), expectedKey);
        }
    });
}

test('both validators snapshot valid measurements without mutating or coercing them', () => {
    const sdkValidator = sdkRequire('./lib/biometric_features').validateBiometricFeatures;
    const standaloneValidator = require('../biometric-entropy-client/biometric_features').validateBiometricFeatures;
    for (const validate of [sdkValidator, standaloneValidator]) {
        const input = Object.freeze(valid.slice());
        const snapshot = validate(input);
        assert.notStrictEqual(snapshot, input);
        assert.deepEqual(snapshot, valid);
        snapshot[0] = 0;
        assert.equal(input[0], 0.5);
    }
});

test('Node SDK rejects malformed biometrics before any proof, registration or submission', async () => {
    const calls = [];
    const sdk = loadModule('sdk/index.js', {
        './lib/groth16_intent': { generateIntentProof: async () => { calls.push('prove'); } },
        './lib/anchor_integration': {
            registerContract: async () => { calls.push('register'); },
            submitVerifiedGroth16: async () => { calls.push('submit'); },
            submitVerifiedMultiSig: async () => { calls.push('submit-multisig'); },
        },
    });
    for (const features of invalidVectors()) {
        assert.throws(() => sdk.deriveKey(features), validationError);
        for (const method of ['generateProof', 'signContract', 'signMultiSig']) {
            await assert.rejects(sdk[method](features, 'exact agreement'), validationError);
        }
    }
    assert.deepEqual(calls, []);
});

test('browser SDK rejects malformed biometrics before hashing or proving', async () => {
    const calls = [];
    const sdk = loadModule('sdk/browser.js', {
        snarkjs: { groth16: {
            fullProve: async () => { calls.push('prove'); },
            verify: async () => { calls.push('verify'); },
        } },
    }, {
        crypto: { subtle: { digest: async () => { calls.push('hash'); } } },
    });
    for (const features of invalidVectors()) {
        assert.throws(() => sdk.deriveKey(features), validationError);
        await assert.rejects(sdk.generateProof(features, 'exact agreement', {
            wasmUrl: 'unused.wasm', zkeyUrl: 'unused.zkey',
        }), validationError);
    }
    assert.deepEqual(calls, []);
});
