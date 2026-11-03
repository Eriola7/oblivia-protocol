const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const root = path.join(__dirname, '..');

// Load the browser module in a context without Buffer, as a bundler would.
function loadPasskey(navigator) {
    const filename = path.join(root, 'sdk/lib/passkey.js');
    const context = vm.createContext({
        module: { exports: {} },
        require: createRequire(filename),
        TextEncoder, Uint8Array, ArrayBuffer, btoa, atob,
        crypto: crypto.webcrypto,
        navigator,
    });
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
    return context.module.exports;
}

const prfSecret = new Uint8Array(32).fill(7);

function credentials({ prfResult = prfSecret, enabled = true, createResult, getResult } = {}) {
    const calls = { create: [], get: [] };
    return {
        calls,
        async create(options) {
            calls.create.push(options);
            if (createResult !== undefined) return createResult;
            return { rawId: new Uint8Array([251, 255, 1]).buffer, getClientExtensionResults: () => ({ prf: { enabled } }) };
        },
        async get(options) {
            calls.get.push(options);
            if (getResult !== undefined) return getResult;
            return { getClientExtensionResults: () => (prfResult ? { prf: { results: { first: prfResult.buffer } } } : {}) };
        },
    };
}

test('unlocking requires user verification and returns the 32-byte PRF secret for a fixed salt', async () => {
    const creds = credentials();
    const passkey = loadPasskey({ credentials: creds });
    const secret = await passkey.getPasskeySecret();
    assert.deepEqual(Array.from(secret), Array.from(prfSecret));
    await passkey.getPasskeySecret();
    const [first, second] = creds.calls.get.map(call => call.publicKey);
    assert.equal(first.userVerification, 'required');
    assert.deepEqual(Array.from(first.extensions.prf.eval.first), Array.from(second.extensions.prf.eval.first),
        'the same salt is used on every device so a synced passkey restores the same secret');
    assert.deepEqual(Array.from(first.extensions.prf.eval.first),
        Array.from(crypto.createHash('sha256').update('oblivia/passkey-prf/v1').digest()));
    assert.notDeepEqual(Array.from(first.challenge), Array.from(second.challenge));
    assert.equal(first.allowCredentials, undefined, 'discoverable credentials work on a new device');
});

test('a stored credential ID is round-tripped through base64url', async () => {
    const creds = credentials();
    const passkey = loadPasskey({ credentials: creds });
    const { credentialId } = await passkey.createSignerPasskey({ rpId: 'example.test', userName: 'Signer' });
    assert.equal(credentialId, '-_8B');
    const create = creds.calls.create[0].publicKey;
    assert.equal(create.authenticatorSelection.userVerification, 'required');
    assert.equal(create.authenticatorSelection.residentKey, 'required');
    assert.equal(create.rp.id, 'example.test');
    assert.equal(JSON.stringify(create.extensions), '{"prf":{}}');
    await passkey.getPasskeySecret({ credentialId, rpId: 'example.test' });
    const get = creds.calls.get[0].publicKey;
    assert.deepEqual(Array.from(get.allowCredentials[0].id), [251, 255, 1]);
    assert.equal(get.rpId, 'example.test');
});

test('missing WebAuthn, missing PRF support and cancellations fail closed', async () => {
    await assert.rejects(loadPasskey({}).getPasskeySecret(), { name: 'PasskeyUnavailableError' });
    await assert.rejects(loadPasskey(undefined).getPasskeySecret(), { name: 'PasskeyUnavailableError' });
    for (const options of [{ prfResult: null }, { prfResult: new Uint8Array(16).fill(1) }, { getResult: null }]) {
        await assert.rejects(loadPasskey({ credentials: credentials(options) }).getPasskeySecret(),
            { name: 'PasskeyUnavailableError' });
    }
    await assert.rejects(loadPasskey({ credentials: credentials({ enabled: false }) }).createSignerPasskey(),
        /does not support the PRF extension/);
    await assert.rejects(loadPasskey({ credentials: credentials({ createResult: null }) }).createSignerPasskey(),
        /cancelled/);
    // Platforms that only report PRF at assertion time may omit "enabled" on creation.
    const unknown = loadPasskey({ credentials: credentials({ enabled: undefined }) });
    assert.match((await unknown.createSignerPasskey()).credentialId, /^[A-Za-z0-9_-]+$/);
});

test('the PRF secret feeds the signer key derivation deterministically', async () => {
    const { deriveSignerKey } = require('../sdk/lib/signer_key');
    const deviceA = await loadPasskey({ credentials: credentials() }).getPasskeySecret();
    const deviceB = await loadPasskey({ credentials: credentials() }).getPasskeySecret();
    assert.equal(deriveSignerKey(deviceA), deriveSignerKey(deviceB));
});
