// Offline tests for the published package. No wallet, RPC or transaction.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const oblivia = require('@oblivia/sdk');
const browser = require('@oblivia/sdk/browser');

const secret = Uint8Array.from({ length: 32 }, (_, i) => 255 - i);
const contract = 'Oblivia SDK package test agreement';

test.after(async () => {
    // snarkjs caches a worker pool; release it so the test process exits.
    if (globalThis.curve_bn128) await globalThis.curve_bn128.terminate();
});

test('package exposes the documented Node and browser APIs', () => {
    for (const name of ['generateSignerSecret', 'deriveSignerKey', 'generateProof', 'signContract',
        'createMultiSigContract', 'signMultiSig', 'finalizeMultiSigContract', 'initializeRegistry']) {
        assert.equal(typeof oblivia[name], 'function', name);
    }
    for (const name of ['createSignerPasskey', 'getPasskeySecret', 'deriveSignerKey', 'generateProof']) {
        assert.equal(typeof browser[name], 'function', name);
    }
    assert.equal(oblivia.deriveKey, undefined);
});

test('signer keys are deterministic per contract and identical across entry points', () => {
    const hash = require('node:crypto').createHash('sha256').update(contract).digest();
    const other = require('node:crypto').createHash('sha256').update(contract + '!').digest();
    const key = oblivia.deriveSignerKey(secret, hash);
    assert.equal(oblivia.deriveSignerKey(Uint8Array.from(secret), hash), key);
    assert.equal(browser.deriveSignerKey(secret, hash), key);
    assert.notEqual(oblivia.deriveSignerKey(secret, other), key, 'unlinkable across contracts');
    assert.notEqual(oblivia.deriveSignerKey(oblivia.generateSignerSecret(), hash), key);
    assert.throws(() => oblivia.deriveSignerKey(new Uint8Array(16).fill(1), hash), /signerSecret/);
});

test('Node proof is locally verified and binds the full contract hash', { timeout: 120000 }, async () => {
    const proof = await oblivia.generateProof(secret, contract);
    assert.equal(proof.contractHash.length, 32);
    assert.equal(proof.publicInputs.length, 128);
    const hashHex = Buffer.from(proof.contractHash).toString('hex');
    const lo = Buffer.from(proof.publicInputs.slice(64, 96)).toString('hex');
    const hi = Buffer.from(proof.publicInputs.slice(96, 128)).toString('hex');
    assert.equal(lo.slice(32) + hi.slice(32), hashHex, 'both 128-bit limbs carry all 32 hash bytes');
});

test('browser proof uses the same key commitment as the Node proof', { timeout: 120000 }, async () => {
    const proving = path.join(path.dirname(require.resolve('@oblivia/sdk')), 'lib/proving');
    const nodeProof = await oblivia.generateProof(secret, contract);
    const browserProof = await browser.generateProof(secret, contract, {
        wasmUrl: path.join(proving, 'oblivia.wasm'),
        zkeyUrl: path.join(proving, 'oblivia_1.zkey'),
    });
    assert.equal(browserProof.verified, true);
    assert.equal(BigInt(browserProof.publicInputs[0]),
        BigInt('0x' + Buffer.from(nodeProof.keyCommitment).toString('hex')));
});

test('submission without a configured fee payer fails with a clear error', async () => {
    await assert.rejects(oblivia.createMultiSigContract(contract, 1, 1), /OBLIVIA_DEVNET_KEY/);
});
