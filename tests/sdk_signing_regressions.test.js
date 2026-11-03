const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');

const root = path.join(__dirname, '..');
const sdkRequire = createRequire(path.join(root, 'sdk/index.js'));
const secret = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
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
        const expectedScalar = sdkRequire('./lib/signer_key').deriveSignerKey(secret);
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
        const result = await sdk[method](secret, contract);
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
        await assert.rejects(sdk[method](secret, contract), /proving unavailable/);
        assert.deepEqual(calls, [], 'a failed proof must not register or submit anything');
        failProving = false;
        await assert.rejects(sdk[method](secret, contract), /submission rejected/);
        assert.deepEqual(calls, method === 'signContract' ? ['register', 'submit'] : ['submit']);
    });
}

test('signer key derivation is deterministic, domain-separated, Buffer-free and in the BN254 field', () => {
    const nodeKeys = sdkRequire('./lib/signer_key');
    const browserKeys = loadModule('sdk/lib/signer_key.js'); // No Buffer global.
    const field = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');
    for (const input of [secret, new Uint8Array(32).fill(255), Uint8Array.from({ length: 64 }, (_, i) => i)]) {
        const key = nodeKeys.deriveSignerKey(input);
        assert.equal(browserKeys.deriveSignerKey(input), key);
        assert.equal(nodeKeys.deriveSignerKey(Buffer.from(input)), key, 'Buffer and Uint8Array secrets agree');
        assert.match(key, /^[1-9][0-9]*$/);
        assert.ok(BigInt(key) < 2n ** 248n && BigInt(key) < field);
        const digest = crypto.createHash('sha256')
            .update(Buffer.concat([Buffer.from('oblivia/signer-key/v1'), Buffer.from([0]), Buffer.from(input)]))
            .digest();
        assert.equal(key, BigInt('0x' + digest.subarray(0, 31).toString('hex')).toString());
    }
    assert.notEqual(nodeKeys.deriveSignerKey(secret), nodeKeys.deriveSignerKey(Uint8Array.from(secret, b => b ^ 1)));
});

test('weak or malformed signer secrets are rejected before proving or submission', async () => {
    const calls = [];
    const sdk = loadModule('sdk/index.js', {
        './lib/groth16_intent': { generateIntentProof: async () => { calls.push('prove'); } },
        './lib/anchor_integration': { registerContract: async () => calls.push('register') },
    });
    for (const bad of [undefined, null, 'a'.repeat(64), Array(32).fill(1), new Uint8Array(31).fill(1),
        new Uint8Array(32), new Uint16Array(32).fill(1), new DataView(new ArrayBuffer(32))]) {
        await assert.rejects(sdk.signContract(bad, contract), /signerSecret/);
        await assert.rejects(sdk.signMultiSig(bad, contract), /signerSecret/);
    }
    assert.deepEqual(calls, []);
});

test('Node generateSignerSecret returns fresh 32-byte secrets', () => {
    const sdk = loadModule('sdk/index.js', { './lib/anchor_integration': {} });
    const a = sdk.generateSignerSecret();
    const b = sdk.generateSignerSecret();
    assert.equal(a.length, 32);
    assert.notDeepEqual(Array.from(a), Array.from(b));
    assert.match(sdk.deriveSignerKey(a), /^[0-9]+$/);
    assert.equal(sdk.deriveKey, undefined, 'the biometric deriveKey API was removed');
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
    const sdk = loadModule('sdk/index.js', {
        './lib/anchor_integration': {}, // No provider, wallet, RPC, or transaction is loaded.
    });
    const browserSdk = loadModule('sdk/browser.js', {
        './lib/signer_key': loadModule('sdk/lib/signer_key.js'),
        './lib/passkey': loadModule('sdk/lib/passkey.js'),
    });
    try {
        const nodeProof = await sdk.generateProof(secret, contract);
        const browserProof = await browserSdk.generateProof(secret, contract, {
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
