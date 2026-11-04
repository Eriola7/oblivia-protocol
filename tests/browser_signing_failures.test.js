const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const signerKeys = require('../sdk/lib/signer_key');
const passkeyDomain = require('../sdk/lib/passkey_domain');
const passkeySecret = () => new Uint8Array(32).fill(5);

const source = fs.readFileSync(path.join(__dirname, '../browser-client/src/main.js'), 'utf8');
const transaction = '2'.repeat(88);
const generatedProof = {
    proof: { pi_a: ['1', '2'], pi_b: [['3', '4'], ['5', '6']], pi_c: ['7', '8'] },
    publicSignals: ['9', '10', '11', '12'],
};

function element() {
    const classes = new Set();
    const listeners = new Map();
    let textContent = '';
    return {
        disabled: false, children: [],
        get textContent() { return textContent; },
        set textContent(value) { textContent = value; this.children = []; },
        classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) },
        appendChild(child) { this.children.push(child); },
        addEventListener(name, handler) { listeners.set(name, handler); },
        dispatch(name) { return listeners.get(name)?.(); },
        set innerHTML(value) { assert.equal(value, ''); this.children = []; this.textContent = ''; },
    };
}

function browser(overrides = {}) {
    const elements = new Map();
    const getElementById = id => {
        if (!elements.has(id)) elements.set(id, element());
        return elements.get(id);
    };
    const calls = { proofs: [], requests: [], unlocks: 0, creates: 0, passkeyOptions: [] };
    let loaded;
    const context = vm.createContext({
        require(name) {
            if (name === '@noble/hashes/sha2.js') return { sha256: bytes => crypto.createHash('sha256').update(bytes).digest() };
            if (name === '../../sdk/lib/signer_key') return signerKeys;
            if (name === '../../sdk/lib/passkey') return {
                getPasskeySecret: async options => { calls.unlocks++; calls.passkeyOptions.push(options); return overrides.getPasskeySecret ? overrides.getPasskeySecret() : passkeySecret(); },
                createSignerPasskey: async options => { calls.creates++; calls.passkeyOptions.push(options); return { credentialId: 'AQID' }; },
            };
            if (name === '../../sdk/lib/passkey_domain') return passkeyDomain;
            if (name === './passkey_config') return overrides.passkeyConfig || { rpId: 'example.test', testMode: false };
            if (name === 'snarkjs') return { groth16: { async fullProve(input) {
                calls.proofs.push(input);
                return overrides.prove ? overrides.prove(input) : generatedProof;
            } } };
            return {};
        },
        window: { location: { hostname: overrides.hostname || 'app.example.test' }, addEventListener: (_, handler) => { loaded = handler; } }, Buffer, Uint8Array, TextEncoder,
        document: { getElementById, createElement: () => element() },
        fetch: async (url, options) => {
            calls.requests.push({ url, options });
            return overrides.fetch ? overrides.fetch(url, options) : { ok: true, json: async () => ({ transaction }) };
        },
    });
    vm.runInContext(source, context);
    loaded();
    vm.runInContext('signerUnlocked = true; signerSecret = new Uint8Array(32).fill(5);', context);
    getElementById('contract').value = 'Browser failure regression contract';
    return { context, calls, element: getElementById, logs: () => getElementById('log').children.map(line => line.textContent).join('\n') };
}

test('proof generation failure releases the button, reports failure, and permits a successful retry', async () => {
    let fail = true;
    const b = browser({ prove: async () => {
        if (fail) throw new Error('proving asset unavailable');
        return generatedProof;
    } });
    b.element('proofDisplay').textContent = 'stale previous proof';
    await b.context.window.signContract();
    assert.equal(b.element('signBtn').disabled, false);
    assert.equal(b.element('contractSignedDisplay').textContent, 'FALSE');
    assert.equal(b.element('proofDisplay').textContent, 'not generated');
    assert.equal(b.element('result').classList.contains('show'), true);
    assert.match(b.element('txDisplay').textContent, /not submitted/);
    assert.match(b.logs(), /Failed during proof generation: proving asset unavailable/);
    assert.doesNotMatch(b.logs(), /Proof verified|Signed on-chain|Done\./);
    assert.equal(b.calls.requests.length, 0);
    assert.equal(b.calls.proofs[0].signer_key, '0');

    fail = false;
    await b.context.window.signContract();
    assert.equal(b.element('signBtn').disabled, true);
    assert.equal(b.element('contractSignedDisplay').textContent, 'TRUE');
    assert.equal(b.calls.requests.length, 1);
    assert.equal(b.calls.proofs[1].signer_key, '0');
    const body = JSON.parse(b.calls.requests[0].options.body);
    assert.equal(body.publicInputs.length, 128);
    assert.equal(body.signer_key, undefined);
    assert.equal(body.biometricFeatures, undefined);
    assert.match(b.logs(), /Proof generated — awaiting on-chain verification/);
    assert.doesNotMatch(b.logs(), /Proof verified/);
    assert.equal(b.element('txDisplay').children.at(-1).href, `https://explorer.solana.com/tx/${transaction}?cluster=devnet`);
});

test('agreement is locked while signing and its exact snapshot remains with the receipt', async () => {
    let finish;
    const b = browser({ prove: () => new Promise(resolve => { finish = resolve; }) });
    const original = 'Pay Alice 1 SOL';
    b.element('contract').value = original;
    const signing = b.context.window.signContract();
    assert.equal(b.element('contract').disabled, true);
    assert.equal(b.element('signedContractDisplay').textContent, original);
    // Defensive check: a programmatic edit bypassing the disabled editor still
    // must not associate the receipt with the newly displayed agreement.
    b.element('contract').value = 'Pay Bob 999 SOL';
    finish(generatedProof);
    await signing;
    const submitted = JSON.parse(b.calls.requests[0].options.body);
    assert.equal(Buffer.from(submitted.contractHash).toString('hex'), crypto.createHash('sha256').update(original).digest('hex'));
    assert.equal(b.element('contractSignedDisplay').textContent, 'TEXT CHANGED');
    assert.equal(b.element('signedContractDisplay').textContent, original);
    assert.equal(b.element('contract').disabled, false);
});

test('editing an agreement after success invalidates its visible success state', async () => {
    const b = browser();
    await b.context.window.signContract();
    assert.equal(b.element('contractSignedDisplay').textContent, 'TRUE');
    b.element('contract').value = 'A different agreement';
    b.element('contract').dispatch('input');
    assert.equal(b.element('contractSignedDisplay').textContent, 'PENDING');
    assert.equal(b.element('result').classList.contains('show'), false);
    assert.match(b.element('txDisplay').textContent, /not submitted for this text/);
    assert.equal(b.logs(), '');
});

test('local preparation and malformed proof failures recover without submitting', async () => {
    for (const kind of ['preparation', 'proof']) {
        const b = browser({ prove: async () => ({ proof: {}, publicSignals: [] }) });
        if (kind === 'preparation') vm.runInContext('signerSecret = new Uint8Array(4).fill(1);', b.context);
        await b.context.window.signContract();
        assert.equal(b.element('signBtn').disabled, false);
        assert.equal(b.element('contractSignedDisplay').textContent, 'FALSE');
        assert.equal(b.calls.requests.length, 0);
        assert.doesNotMatch(b.logs(), /Signed on-chain|Done\./);
    }
});

test('relay, HTTP, network and malformed-response failures never announce on-chain success', async () => {
    const failures = [
        async () => ({ ok: true, json: async () => ({ error: 'proof rejected' }) }),
        async () => ({ ok: false, json: async () => ({ transaction }) }),
        async () => { throw new Error('connection lost'); },
        async () => ({ ok: true, json: async () => ({}) }),
        async () => ({ ok: true, json: async () => null }),
        async () => ({ ok: true, json: async () => ({ transaction: '<invalid>' }) }),
        async () => ({ ok: true, json: async () => { throw new Error('invalid JSON'); } }),
    ];
    for (const fetch of failures) {
        const b = browser({ fetch });
        await b.context.window.signContract();
        assert.equal(b.element('signBtn').disabled, false);
        assert.equal(b.element('contractSignedDisplay').textContent, 'UNCONFIRMED');
        assert.match(b.element('txDisplay').textContent, /confirmation unavailable/);
        assert.equal(b.calls.requests.length, 1);
        assert.doesNotMatch(b.logs(), /Signed on-chain|Done\./);
        assert.equal(b.calls.proofs[0].signer_key, '0');
    }
});

test('overlapping sign calls do not generate or submit a duplicate proof', async () => {
    let finish;
    const b = browser({ prove: () => new Promise(resolve => { finish = resolve; }) });
    const first = b.context.window.signContract();
    await b.context.window.signContract();
    await b.context.window.unlockSigner();
    assert.equal(b.calls.unlocks, 0, 'unlocking cannot replace the signer mid-signature');
    assert.equal(b.calls.proofs.length, 1);
    assert.equal(b.calls.requests.length, 0);
    assert.equal(b.element('signBtn').disabled, true);
    finish(generatedProof);
    await first;
    assert.equal(b.calls.requests.length, 1);
    assert.equal(b.element('signBtn').disabled, true);
});

test('sequential signing with the same passkey preserves its receipt without proving or submitting again', async () => {
    const b = browser();
    await b.context.window.signContract();
    const originalProof = b.element('proofDisplay').textContent;
    await b.context.window.signContract();
    assert.equal(b.calls.proofs.length, 1);
    assert.equal(b.calls.requests.length, 1);
    assert.equal(b.element('contractSignedDisplay').textContent, 'TRUE');
    assert.equal(b.element('proofDisplay').textContent, originalProof);
    assert.equal(b.element('txDisplay').children.length, 1);
    assert.equal(b.element('txDisplay').children[0].href, `https://explorer.solana.com/tx/${transaction}?cluster=devnet`);
    assert.equal(b.element('signBtn').disabled, true);
});

test('changed agreements remain signable and returning to a known agreement restores its receipt', async () => {
    for (const unlockAgain of [false, true]) {
        const b = browser();
        const original = b.element('contract').value;
        await b.context.window.signContract();
        b.element('contract').value = 'A different agreement';
        b.element('contract').dispatch('input');
        assert.equal(b.element('signBtn').disabled, false);
        await b.context.window.signContract();
        assert.equal(b.calls.requests.length, 2);
        b.element('contract').value = original;
        b.element('contract').dispatch('input');
        if (unlockAgain) await b.context.window.unlockSigner();
        await b.context.window.signContract();
        assert.equal(b.calls.proofs.length, 3, 'the public commitment identifies the previously signed key');
        assert.equal(b.calls.requests.length, 2, 'do not resubmit a known contract/key pair');
        assert.equal(b.element('contractSignedDisplay').textContent, 'TRUE');
        assert.equal(b.element('signedContractDisplay').textContent, original);
        assert.equal(b.element('txDisplay').children.length, 1);
    }
});

test('unlocking again compares public commitments, preserving repeated-key receipts but allowing a different passkey', async () => {
    for (const sameKey of [true, false]) {
        let proofCount = 0;
        const b = browser({
            getPasskeySecret: () => sameKey ? passkeySecret() : new Uint8Array(32).fill(6),
            prove: async () => ({ ...generatedProof, publicSignals: [String(++proofCount === 1 || sameKey ? 9 : 13), '10', '11', '12'] }),
        });
        await b.context.window.signContract();
        await b.context.window.unlockSigner();
        assert.equal(b.element('signBtn').disabled, false);
        await b.context.window.signContract();
        assert.equal(b.calls.proofs.length, 2);
        assert.notEqual(b.calls.proofs[0], b.calls.proofs[1]);
        assert.equal(b.calls.requests.length, sameKey ? 1 : 2);
        assert.equal(b.element('contractSignedDisplay').textContent, 'TRUE');
        assert.equal(b.element('txDisplay').children.length, 1);
        assert.equal(b.element('signBtn').disabled, true);
    }
});

test('the signer key comes from the passkey secret, never a biometric measurement', async () => {
    const b = browser();
    await b.context.window.signContract();
    assert.equal(b.calls.proofs.length, 1);
    const body = JSON.parse(b.calls.requests[0].options.body);
    assert.equal(body.signerSecret, undefined);
    assert.equal(body.biometricFeatures, undefined);
    assert.doesNotMatch(b.calls.requests[0].options.body, /"signer_key"/);
});

test('malformed signer secrets fail before proof generation or submission', async () => {
    for (const expression of ['null', '[1, 2, 3]', '"secret"', 'new Uint8Array(31).fill(1)', 'new Uint8Array(32)', 'new Uint16Array(32).fill(1)']) {
        const b = browser();
        vm.runInContext(`signerSecret = ${expression};`, b.context);
        await b.context.window.signContract();
        assert.equal(b.calls.proofs.length, 0);
        assert.equal(b.calls.requests.length, 0);
        assert.equal(b.element('contractSignedDisplay').textContent, 'FALSE');
        assert.match(b.logs(), /signerSecret/);
    }
});

test('a passkey provider without PRF support cannot become an unlocked signer', async () => {
    const b = browser({ getPasskeySecret: () => { throw new Error('This passkey cannot derive a signing secret (WebAuthn PRF unsupported by the provider)'); } });
    await b.context.window.unlockSigner();
    assert.equal(vm.runInContext('signerUnlocked', b.context), false);
    assert.equal(vm.runInContext('signerSecret', b.context), null);
    assert.equal(b.element('signBtn').disabled, true);
    assert.match(b.logs(), /PRF unsupported/);
    assert.match(b.element('passkeyStatus').textContent, /Try again or create a passkey/);
    await b.context.window.signContract();
    assert.equal(b.calls.proofs.length, 0);
});

test('a cancelled unlock wipes the previous secret and allows another attempt', async () => {
    let cancel = true;
    const b = browser({ getPasskeySecret: () => {
        if (cancel) { const error = new Error('The operation was cancelled'); error.name = 'NotAllowedError'; throw error; }
        return passkeySecret();
    } });
    const previous = vm.runInContext('signerSecret', b.context);
    await b.context.window.unlockSigner();
    assert.deepEqual(Array.from(previous), Array(32).fill(0), 'the old secret is zeroed, not just dropped');
    assert.equal(vm.runInContext('signerUnlocked', b.context), false);
    assert.equal(b.element('signBtn').disabled, true);
    await b.context.window.signContract();
    assert.equal(b.calls.proofs.length, 0);
    cancel = false;
    await b.context.window.unlockSigner();
    assert.equal(b.element('signBtn').disabled, false);
    assert.equal(b.element('passkeyBox').classList.contains('active'), true);
    await b.context.window.signContract();
    assert.equal(b.element('contractSignedDisplay').textContent, 'TRUE');
});

test('creating a passkey registers it and then unlocks it in one step', async () => {
    const b = browser();
    vm.runInContext('signerUnlocked = false; signerSecret = null;', b.context);
    await b.context.window.createPasskey();
    assert.equal(b.calls.creates, 1);
    assert.equal(b.calls.unlocks, 1);
    assert.equal(vm.runInContext('signerUnlocked', b.context), true);
    assert.match(b.logs(), /Passkey created/);
});

test('passkeys are only created and unlocked under the configured permanent domain', async () => {
    const b = browser();
    vm.runInContext('signerUnlocked = false; signerSecret = null;', b.context);
    await b.context.window.createPasskey();
    assert.equal(b.calls.creates, 1);
    for (const options of b.calls.passkeyOptions) assert.equal(options.rpId, 'example.test');
    assert.doesNotMatch(b.logs(), /temporary/);
});

test('a page outside the passkey domain, or a build without one, never reaches WebAuthn', async () => {
    for (const [hostname, passkeyConfig, message] of [
        ['example.test.evil.com', { rpId: 'example.test' }, /not the passkey domain example\.test/],
        ['oblivia.netlify.app', { rpId: '' }, /No permanent passkey domain is configured/],
    ]) {
        const b = browser({ hostname, passkeyConfig });
        vm.runInContext('signerUnlocked = false; signerSecret = null;', b.context);
        await b.context.window.createPasskey();
        await b.context.window.unlockSigner();
        assert.equal(b.calls.creates, 0);
        assert.equal(b.calls.unlocks, 0);
        assert.equal(vm.runInContext('signerUnlocked', b.context), false);
        assert.equal(b.element('signBtn').disabled, true);
        assert.match(b.logs(), message);
    }
});

test('explicit test builds work on any host and say the signer is temporary', async () => {
    const b = browser({ hostname: 'random-name.netlify.app', passkeyConfig: { rpId: '', testMode: true } });
    vm.runInContext('signerUnlocked = false; signerSecret = null;', b.context);
    await b.context.window.createPasskey();
    assert.equal(b.calls.creates, 1);
    assert.equal(b.calls.passkeyOptions[0].rpId, undefined);
    assert.match(b.logs(), /Test build: passkeys created here are temporary/);
});

test('signing-page controls are wired by script, not inline attributes', async () => {
    const b = browser();
    vm.runInContext('signerUnlocked = false; signerSecret = null;', b.context);
    b.element('createPasskeyLink').dispatch('click');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(b.calls.creates, 1);
    b.element('signBtn').dispatch('click');
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(b.calls.proofs.length, 1, 'the sign button signs');
    b.element('passkeyBox').dispatch('click');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(b.calls.unlocks, 2, 'the passkey box unlocks');
});
