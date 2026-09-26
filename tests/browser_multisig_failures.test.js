const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const config = require('../sdk/lib/multisig_config');

const source = fs.readFileSync(path.join(__dirname, '../browser-client/src/multisig.js'), 'utf8');
const transaction = '2'.repeat(88);
const multisig = '1'.repeat(32);
const proof = {
    proof: { pi_a: ['1', '2'], pi_b: [['3', '4'], ['5', '6']], pi_c: ['7', '8'] },
    publicSignals: ['9', '10', '11', '12'],
};
const response = (data, ok = true) => ({ ok, json: async () => data });

function element() {
    const listeners = new Map();
    return {
        value: '', textContent: '', disabled: false, style: {}, children: [],
        appendChild(child) { this.children.push(child); },
        addEventListener(name, handler) { listeners.set(name, handler); },
        dispatch(name) { return listeners.get(name)?.(); },
    };
}

function browser(overrides = {}) {
    const elements = new Map();
    const get = id => {
        if (!elements.has(id)) elements.set(id, element());
        return elements.get(id);
    };
    const calls = { requests: [], proofs: [] };
    let loaded;
    const context = vm.createContext({
        require(name) {
            if (name === '@noble/hashes/sha2.js') return { sha256: bytes => crypto.createHash('sha256').update(bytes).digest() };
            if (name === '../../sdk/lib/multisig_config') return config;
            if (name === 'snarkjs') return { groth16: { fullProve: async input => {
                calls.proofs.push(input);
                return overrides.prove ? overrides.prove(input) : proof;
            } } };
            return {};
        },
        window: {
            location: { origin: 'https://example.test', pathname: '/multisig.html', search: '' },
            addEventListener: (_, handler) => { loaded = handler; },
        },
        document: { getElementById: get, createElement: element },
        Buffer, Uint8Array, TextEncoder, URLSearchParams,
        fetch: async (url, options) => {
            calls.requests.push({ url, options });
            if (overrides.fetch) return overrides.fetch(url, options);
            return response({ transaction, multisig, collected: 1, threshold: 2, finalized: false });
        },
    });
    vm.runInContext(source, context);
    loaded();
    get('contractInput').value = 'Agreement 📝';
    get('threshold').value = '2';
    get('maxSigners').value = '3';
    get('shareBox').style.display = 'none';
    vm.runInContext('biometricCaptured = true; biometricFeatures = Array(20).fill(0.5); currentHash = Array(32).fill(1);', context);
    return {
        context, calls, get,
        sign: () => vm.runInContext('doSign()', context),
        logs: () => get('log').children.map(line => line.textContent).join('\n'),
    };
}

test('multisig creation preserves numeric values and rejects fractional or out-of-range settings', async () => {
    const b = browser();
    b.get('threshold').value = '1e1';
    b.get('maxSigners').value = '10';
    await b.context.window.createMultisig();
    assert.equal(JSON.parse(b.calls.requests[0].options.body).threshold, 10);
    for (const [threshold, maxSigners] of [['2.5', '3'], ['1', '2.5'], ['', '3'], ['0', '3'], ['4', '3'], ['1', '256'], ['NaN', '3']]) {
        const invalid = browser();
        invalid.get('threshold').value = threshold;
        invalid.get('maxSigners').value = maxSigners;
        await invalid.context.window.createMultisig();
        assert.equal(invalid.calls.requests.length, 0);
        assert.equal(invalid.get('createBtn').disabled, false);
    }
});

test('multisig creation rejects HTTP and malformed responses without announcing success', async () => {
    for (const result of [response({ message: 'Service unavailable' }, false), response(null), response({}), response({ multisig }), response({ transaction, multisig: '<bad>' }), response({ error: 'conflicting settings' })]) {
        const b = browser({ fetch: async () => result });
        await b.context.window.createMultisig();
        assert.equal(b.get('shareBox').style.display, 'none');
        assert.equal(b.get('createBtn').disabled, false);
        assert.doesNotMatch(b.logs(), /created on-chain|already exists on-chain/);
    }
    const existing = browser({ fetch: async () => response({ multisig, alreadyExists: true }) });
    await existing.context.window.createMultisig();
    assert.equal(existing.get('shareBox').style.display, 'block');
    assert.match(existing.logs(), /already exists on-chain/);
    existing.get('contractInput').dispatch('input');
    assert.equal(existing.get('shareBox').style.display, 'none');
});

test('multisig create cannot overlap and freezes the agreement settings until completion', async () => {
    let finish;
    const b = browser({ fetch: () => new Promise(resolve => { finish = resolve; }) });
    const first = b.context.window.createMultisig();
    await b.context.window.createMultisig();
    assert.equal(b.calls.requests.length, 1);
    for (const id of ['contractInput', 'threshold', 'maxSigners']) assert.equal(b.get(id).disabled, true);
    finish(response({ transaction, multisig }));
    await first;
    for (const id of ['contractInput', 'threshold', 'maxSigners']) assert.equal(b.get(id).disabled, false);
    assert.match(b.get('shareLink').value, /\?c=Agreement/);
});

test('failed multisig submissions never announce on-chain success', async () => {
    const failures = [
        async () => response({ message: 'Service unavailable' }, false),
        async () => response({ transaction, collected: 1, threshold: 2, finalized: false }, false),
        async () => response({ error: 'proof rejected' }),
        async () => response({}),
        async () => response(null),
        async () => response({ statusUnavailable: true }),
        async () => response({ transaction: '<bad>' }),
        async () => { throw new Error('network failure'); },
        async () => ({ ok: true, json: async () => { throw new Error('invalid JSON'); } }),
    ];
    for (const fetch of failures) {
        const b = browser({ fetch });
        await b.sign();
        assert.doesNotMatch(b.logs(), /Signed on-chain|Signature confirmed|Threshold reached/);
        assert.equal(b.get('scanBtn').disabled, false);
        assert.match(b.get('progress').textContent, /Submission unconfirmed/);
        assert.doesNotMatch(b.get('progress').textContent, /undefined/);
        assert.equal(b.calls.proofs[0].signer_key, '0');
    }
});

test('multisig success validates counters and uses a locally constructed Explorer link', async () => {
    for (const collected of [1, 2]) {
        const b = browser({ fetch: async () => response({ transaction, collected, threshold: 2, finalized: collected === 2, explorer: 'javascript:bad' }) });
        await b.sign();
        assert.match(b.logs(), /Signed on-chain/);
        assert.equal(b.get('scanBtn').disabled, true);
        assert.equal(b.get('txLink').children[0].href, `https://explorer.solana.com/tx/${transaction}?cluster=devnet`);
        assert.match(b.get('progress').textContent, new RegExp(`${collected} of 2 signed`));
        assert.equal(b.logs().includes('Threshold reached'), collected === 2);
        const submitted = JSON.parse(b.calls.requests[0].options.body);
        assert.equal(submitted.publicInputs.length, 128);
        assert.equal(submitted.signer_key, undefined);
    }
});

test('confirmed transaction with unavailable state keeps its receipt and does not invite another signature', async () => {
    const b = browser({ fetch: async () => response({ transaction, statusUnavailable: true }) });
    await b.sign();
    assert.equal(b.get('scanBtn').disabled, true);
    assert.match(b.get('progress').textContent, /Signature confirmed — threshold status unavailable/);
    assert.equal(b.get('txLink').children.length, 1);
    assert.doesNotMatch(b.logs(), /Threshold reached/);
    assert.doesNotMatch(b.get('progress').textContent, /undefined/);
});

test('malformed multisig counters cannot produce a finalization claim', async () => {
    for (const status of [{}, { collected: '1', threshold: 2, finalized: false }, { collected: 0, threshold: 2, finalized: false }, { collected: 3, threshold: 2, finalized: true }, { collected: 1, threshold: 2, finalized: true }]) {
        const b = browser({ fetch: async () => response({ transaction, ...status }) });
        await b.sign();
        assert.doesNotMatch(b.logs(), /Signed on-chain|Threshold reached/);
        assert.match(b.get('progress').textContent, /agreement status unavailable/);
        assert.equal(b.get('scanBtn').disabled, true, 'retain the known receipt instead of inviting a duplicate retry');
    }
});

test('local multisig proof failure recovers, clears the witness, and permits retry', async () => {
    let fail = true;
    const b = browser({ prove: async () => { if (fail) throw new Error('proving failed'); return proof; } });
    await b.sign();
    assert.equal(b.calls.requests.length, 0);
    assert.equal(b.get('scanBtn').disabled, false);
    assert.equal(b.calls.proofs[0].signer_key, '0');
    fail = false;
    await b.sign();
    assert.equal(b.calls.requests.length, 1);
    assert.equal(b.get('scanBtn').disabled, true);
});

test('multisig status lookup rejects bad HTTP and malformed counters', async () => {
    for (const result of [response({ message: 'unavailable' }, false), response(null), response({ collected: 1, threshold: 2, finalized: true })]) {
        const b = browser({ fetch: async () => result });
        await vm.runInContext('refreshStatus()', b.context);
        assert.equal(b.get('progress').textContent, 'Agreement status unavailable');
    }
});

test('HTML templates let HtmlWebpackPlugin insert each entry bundle exactly once', () => {
    for (const [html, script] of [['index', 'main'], ['multisig', 'multisig']]) {
        const template = fs.readFileSync(path.join(__dirname, `../browser-client/src/${html}.html`), 'utf8');
        assert.doesNotMatch(template, new RegExp(`<script[^>]*src=["']${script}\\.js`));
    }
});
