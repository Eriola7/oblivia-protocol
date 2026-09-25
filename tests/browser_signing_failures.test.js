const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const source = fs.readFileSync(path.join(__dirname, '../browser-client/src/main.js'), 'utf8');
const transaction = '2'.repeat(88);
const generatedProof = {
    proof: { pi_a: ['1', '2'], pi_b: [['3', '4'], ['5', '6']], pi_c: ['7', '8'] },
    publicSignals: ['9', '10', '11', '12'],
};

function element() {
    const classes = new Set();
    return {
        textContent: '', disabled: false, children: [],
        classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) },
        appendChild(child) { this.children.push(child); },
        set innerHTML(value) { assert.equal(value, ''); this.children = []; this.textContent = ''; },
    };
}

function browser(overrides = {}) {
    const elements = new Map();
    const getElementById = id => {
        if (!elements.has(id)) elements.set(id, element());
        return elements.get(id);
    };
    const calls = { proofs: [], requests: [] };
    const context = vm.createContext({
        require(name) {
            if (name === '@noble/hashes/sha2.js') return { sha256: bytes => crypto.createHash('sha256').update(bytes).digest() };
            if (name === 'snarkjs') return { groth16: { async fullProve(input) {
                calls.proofs.push(input);
                return overrides.prove ? overrides.prove(input) : generatedProof;
            } } };
            return {};
        },
        window: {}, Buffer, Uint8Array, TextEncoder,
        document: { getElementById, createElement: tag => tag === 'video' && overrides.video ? overrides.video : element() },
        navigator: { mediaDevices: { getUserMedia: overrides.getUserMedia } },
        setTimeout: resolve => resolve(),
        fetch: async (url, options) => {
            calls.requests.push({ url, options });
            return overrides.fetch ? overrides.fetch(url, options) : { ok: true, json: async () => ({ transaction }) };
        },
    });
    vm.runInContext(source, context);
    vm.runInContext('biometricCaptured = true; biometricFeatures = Array(20).fill(0.5);', context);
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
    assert.equal(b.element('signBtn').disabled, false);
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

test('local preparation and malformed proof failures recover without submitting', async () => {
    for (const kind of ['preparation', 'proof']) {
        const b = browser({ prove: async () => ({ proof: {}, publicSignals: [] }) });
        if (kind === 'preparation') vm.runInContext('deriveKey = () => { throw new Error("invalid features"); };', b.context);
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
    await b.context.window.captureBiometric();
    assert.equal(b.calls.proofs.length, 1);
    assert.equal(b.calls.requests.length, 0);
    assert.equal(b.element('signBtn').disabled, true);
    finish(generatedProof);
    await first;
    assert.equal(b.calls.requests.length, 1);
    assert.equal(b.element('signBtn').disabled, false);
});

test('camera failure stops the stream, clears stale capture state, and allows another scan', async () => {
    let stopped = 0;
    let streams = 0;
    const video = { play: async () => { throw new Error('video playback failed'); } };
    const b = browser({
        video,
        getUserMedia: async () => { streams++; return { getTracks: () => [{ stop: () => { stopped++; } }] }; },
    });
    vm.runInContext('detector = {};', b.context);
    await b.context.window.captureBiometric();
    assert.equal(stopped, 1);
    assert.equal(video.srcObject, null);
    assert.equal(vm.runInContext('biometricFeatures', b.context), null);
    assert.equal(vm.runInContext('biometricCaptured', b.context), false);
    assert.equal(b.element('signBtn').disabled, true);
    await b.context.window.signContract();
    assert.equal(b.calls.proofs.length, 0);
    await b.context.window.captureBiometric();
    assert.equal(streams, 2);
    assert.equal(stopped, 2);
});
