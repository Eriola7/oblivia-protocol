const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const config = require('../sdk/lib/multisig_config');
const signerKeys = require('../sdk/lib/signer_key');
const passkeyDomain = require('../sdk/lib/passkey_domain');

const source = fs.readFileSync(path.join(__dirname, '../browser-client/src/multisig.js'), 'utf8');
const transaction = '2'.repeat(88);
const multisig = '1'.repeat(32);
const proof = {
    proof: { pi_a: ['1', '2'], pi_b: [['3', '4'], ['5', '6']], pi_c: ['7', '8'] },
    publicSignals: ['9', '10', '11', '12'],
};
const response = (data, ok = true) => ({ ok, json: async () => data });
const finalized = { collected: 2, threshold: 2, finalized: true };

function deferred() {
    let resolve, reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}

function assertFinalized(b) {
    assert.equal(b.get('progress').textContent, '2 of 2 signed — FINALIZED ✓');
    assert.equal(b.get('scanBtn').textContent, 'Agreement Finalized');
    assert.equal(b.get('scanBtn').disabled, true);
}

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
    const calls = { requests: [], proofs: [], unlocks: 0, creates: 0, rpIds: [] };
    let loaded;
    const context = vm.createContext({
        require(name) {
            if (name === '@noble/hashes/sha2.js') return { sha256: bytes => crypto.createHash('sha256').update(bytes).digest() };
            if (name === '../../sdk/lib/multisig_config') return config;
            if (name === '../../sdk/lib/signer_key') return signerKeys;
            if (name === '../../sdk/lib/passkey') return {
                getPasskeySecret: async () => { calls.unlocks++; return overrides.getPasskeySecret ? overrides.getPasskeySecret() : new Uint8Array(32).fill(5); },
                createSignerPasskey: async options => { calls.creates++; calls.rpIds.push(options.rpId); return { credentialId: 'AQID' }; },
            };
            if (name === '../../sdk/lib/passkey_domain') return passkeyDomain;
            if (name === './passkey_config') return overrides.passkeyConfig || { rpId: 'example.test', testMode: false };
            if (name === 'snarkjs') return { groth16: { fullProve: async input => {
                calls.proofs.push(input);
                return overrides.prove ? overrides.prove(input) : proof;
            } } };
            return {};
        },
        window: {
            location: { origin: 'https://example.test', hostname: overrides.hostname || 'example.test', pathname: '/multisig.html', search: overrides.search || '' },
            addEventListener: (_, handler) => { loaded = handler; },
        },
        document: { getElementById: get, createElement: () => element() },
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
    vm.runInContext('signerUnlocked = true; signerSecret = new Uint8Array(32).fill(5); currentHash = Array(32).fill(1); currentConfig = { threshold: 2, maxSigners: 3 };', context);
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

test('late status responses cannot replace a newer confirmed multisig receipt or status', async () => {
    for (const statusUnavailable of [false, true]) {
        for (const staleFails of [false, true]) {
            let finishStatus;
            const b = browser({ fetch: async (url) => {
                if (url.includes('/multisig/status/')) return new Promise(resolve => { finishStatus = resolve; });
                return response(statusUnavailable
                    ? { transaction, statusUnavailable: true }
                    : { transaction, collected: 2, threshold: 2, finalized: true });
            } });
            const status = vm.runInContext('refreshStatus()', b.context);
            await b.sign();
            const confirmedProgress = b.get('progress').textContent;
            const confirmedButton = b.get('scanBtn').textContent;
            finishStatus(staleFails
                ? response({ error: 'old request failed' }, false)
                : response({ collected: 1, threshold: 2, finalized: false }));
            await status;
            assert.equal(b.get('progress').textContent, confirmedProgress);
            assert.equal(b.get('scanBtn').textContent, confirmedButton);
            assert.equal(b.get('scanBtn').disabled, true);
            assert.equal(b.get('txLink').children.length, 1);
            assert.doesNotMatch(b.logs(), /Status error/);
        }
    }
});

test('overlapping status requests only apply the latest response', async () => {
    const finishes = [];
    const b = browser({ fetch: () => new Promise(resolve => finishes.push(resolve)) });
    const first = vm.runInContext('refreshStatus()', b.context);
    const second = vm.runInContext('refreshStatus()', b.context);
    finishes[1](response({ collected: 2, threshold: 2, finalized: true }));
    await second;
    finishes[0](response({ collected: 1, threshold: 2, finalized: false }));
    await first;
    assert.match(b.get('progress').textContent, /2 of 2 signed — FINALIZED/);
    assert.equal(b.get('scanBtn').disabled, true);
});

test('finalization observed during proof generation prevents submission and survives proof failure', async () => {
    for (const proofFails of [false, true]) {
        const statusReply = deferred();
        const proofReply = deferred();
        const b = browser({ prove: () => proofReply.promise, fetch: () => statusReply.promise });
        const status = vm.runInContext('refreshStatus()', b.context);
        const signing = b.sign();
        statusReply.resolve(response(finalized));
        await status;
        assertFinalized(b);
        if (proofFails) proofReply.reject(new Error('prover failed after finalization'));
        else proofReply.resolve(proof);
        await signing;
        assertFinalized(b);
        assert.equal(b.calls.requests.filter(call => call.options?.method === 'POST').length, 0);
        assert.equal(b.calls.proofs[0].signer_key, '0');
        assert.equal(b.get('txLink').children.length, 0);
        await b.sign();
        assert.equal(b.calls.proofs.length, 1, 'a known finalized agreement cannot start another proof');
    }
});

test('finalization observed during a pending submission survives rejection and keeps any confirmed receipt', async () => {
    const results = [
        () => response({ error: 'MultisigAlreadyFinalized' }, false),
        () => { throw new Error('confirmation connection lost'); },
        () => response({ transaction, statusUnavailable: true }),
        () => response({ transaction, collected: 1, threshold: 2, finalized: false }),
        () => response({ transaction, collected: 'invalid' }),
    ];
    for (const result of results) {
        const statusReply = deferred();
        const submitReply = deferred();
        const submitted = deferred();
        const b = browser({ fetch: url => {
            if (url.includes('/multisig/status/')) return statusReply.promise;
            submitted.resolve();
            return submitReply.promise.then(result);
        } });
        const status = vm.runInContext('refreshStatus()', b.context);
        const signing = b.sign();
        await submitted.promise;
        statusReply.resolve(response(finalized));
        await status;
        assertFinalized(b);
        submitReply.resolve();
        await signing;
        assertFinalized(b);
        assert.equal(b.calls.requests.filter(call => call.options?.method === 'POST').length, 1);
        const hasReceipt = results.indexOf(result) >= 2;
        assert.equal(b.get('txLink').children.length, hasReceipt ? 1 : 0);
        if (hasReceipt) {
            assert.equal(b.get('txLink').children[0].href, `https://explorer.solana.com/tx/${transaction}?cluster=devnet`);
        } else {
            assert.doesNotMatch(b.logs(), /Signed on-chain|Signature confirmed|Threshold reached/);
        }
    }
});

test('passkey unlock failures preserve finalization while ordinary failures remain retryable', async () => {
    for (const finalizes of [false, true]) {
        for (const unlockResult of ['cancelled', 'prf unsupported', 'unlocked']) {
            const statusReply = deferred();
            const unlockReply = deferred();
            const unlocking = deferred();
            const b = browser({
                fetch: () => statusReply.promise,
                getPasskeySecret: async () => {
                    unlocking.resolve();
                    await unlockReply.promise;
                    if (unlockResult === 'cancelled') throw new Error('The operation was cancelled');
                    if (unlockResult === 'prf unsupported') throw new Error('WebAuthn PRF unsupported by the provider');
                    return new Uint8Array(32).fill(5);
                },
            });
            vm.runInContext('signerUnlocked = false; signerSecret = null;', b.context);
            const status = vm.runInContext('refreshStatus()', b.context);
            const unlock = b.context.window.unlockAndSign();
            await unlocking.promise;
            statusReply.resolve(response(finalizes ? finalized : { collected: 1, threshold: 2, finalized: false }));
            await status;
            // The non-finalized successful unlock signs and is tested elsewhere;
            // this matrix checks that normal failures remain retryable.
            if (!finalizes && unlockResult === 'unlocked') unlockReply.reject(new Error('unlock failed'));
            else unlockReply.resolve();
            await unlock;
            if (finalizes) {
                assertFinalized(b);
                assert.equal(b.get('bioStatus').textContent, 'Agreement finalized.');
                assert.equal(b.get('createPasskeyBtn').disabled, true);
            } else {
                assert.equal(b.get('scanBtn').disabled, false);
                assert.match(b.get('bioStatus').textContent, /Try again/);
            }
            assert.equal(b.calls.proofs.length, 0);
            assert.equal(b.calls.requests.filter(call => call.options?.method === 'POST').length, 0);
            assert.equal(vm.runInContext('signerSecret', b.context), null);
            assert.equal(vm.runInContext('signerUnlocked', b.context), false);
        }
    }
});

test('unlocking signs immediately and wipes the secret afterwards', async () => {
    let secret;
    const b = browser({ getPasskeySecret: () => (secret = new Uint8Array(32).fill(9)) });
    vm.runInContext('signerUnlocked = false; signerSecret = null;', b.context);
    await b.context.window.unlockAndSign();
    assert.equal(b.calls.proofs.length, 1);
    assert.equal(b.calls.requests.filter(call => call.options?.method === 'POST').length, 1);
    assert.deepEqual(Array.from(secret), Array(32).fill(0));
    assert.equal(vm.runInContext('signerSecret', b.context), null);
    assert.equal(b.get('scanBtn').disabled, true);
});

test('creating a passkey registers, unlocks and signs in one step', async () => {
    const b = browser();
    vm.runInContext('signerUnlocked = false; signerSecret = null;', b.context);
    await b.context.window.createPasskeyAndSign();
    assert.equal(b.calls.creates, 1);
    assert.deepEqual(b.calls.rpIds, ['example.test']);
    assert.equal(b.calls.unlocks, 1);
    assert.equal(b.calls.proofs.length, 1);
    assert.match(b.logs(), /Passkey created/);
});

test('co-signing outside the configured passkey domain never reaches WebAuthn', async () => {
    const b = browser({ hostname: 'phishing.example' });
    vm.runInContext('signerUnlocked = false; signerSecret = null;', b.context);
    await b.context.window.unlockAndSign();
    await b.context.window.createPasskeyAndSign();
    assert.equal(b.calls.unlocks + b.calls.creates, 0);
    assert.equal(b.calls.proofs.length, 0);
    assert.match(b.logs(), /not the passkey domain example\.test/);
    assert.equal(b.get('scanBtn').disabled, false, 'the user can retry from the correct site');
});

test('validated finalization is not downgraded by later non-finalized or failed status lookups', async () => {
    for (const later of [response({ collected: 1, threshold: 2, finalized: false }), response({ error: 'unavailable' }, false)]) {
        let reads = 0;
        const b = browser({ fetch: async () => ++reads === 1 ? response(finalized) : later });
        await vm.runInContext('refreshStatus()', b.context);
        await vm.runInContext('refreshStatus()', b.context);
        assertFinalized(b);
        await b.sign();
        assert.equal(b.calls.proofs.length, 0);
    }
});

test('malformed multisig signer secrets cannot reach proof generation or submission', async () => {
    for (const expression of ['null', '[1, 2, 3]', '"secret"', 'new Uint8Array(31).fill(1)', 'new Uint8Array(32)', 'new Uint16Array(32).fill(1)']) {
        const b = browser();
        vm.runInContext(`signerSecret = ${expression};`, b.context);
        await b.sign();
        assert.equal(b.calls.proofs.length, 0);
        assert.equal(b.calls.requests.length, 0);
        assert.equal(b.get('scanBtn').disabled, false);
        assert.match(b.logs(), /signerSecret/);
    }
});

test('agreement settings travel in the share link, status lookups and signatures', async () => {
    const creator = browser();
    await creator.context.window.createMultisig();
    const link = new URL(creator.get('shareLink').value);
    assert.equal(link.searchParams.get('t'), '2');
    assert.equal(link.searchParams.get('n'), '3');

    const signer = browser({ search: link.search });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual({ ...vm.runInContext('currentConfig', signer.context) }, { threshold: 2, maxSigners: 3 });
    const status = signer.calls.requests.find(call => call.url.includes('/multisig/status/'));
    assert.match(status.url, /\?threshold=2&maxSigners=3$/);
    await signer.sign();
    const body = JSON.parse(signer.calls.requests.find(call => call.url.endsWith('/multisig/sign')).options.body);
    assert.equal(body.threshold, 2);
    assert.equal(body.maxSigners, 3);
});

test('a share link without valid settings cannot look up or sign an agreement', async () => {
    for (const search of ['?c=Agreement', '?c=Agreement&t=2', '?c=Agreement&t=0&n=3', '?c=Agreement&t=2.5&n=3', '?c=Agreement&t=4&n=3']) {
        const b = browser({ search });
        await new Promise(resolve => setImmediate(resolve));
        vm.runInContext('signerUnlocked = true; signerSecret = new Uint8Array(32).fill(5); currentConfig = null;', b.context);
        await b.sign();
        assert.equal(b.calls.requests.length, 0, search);
        assert.equal(b.calls.proofs.length, 0, search);
        assert.match(b.get('progress').textContent + b.logs(), /missing the agreement settings/, search);
    }
});

test('HTML templates let HtmlWebpackPlugin insert each entry bundle exactly once', () => {
    for (const [html, script] of [['index', 'main'], ['multisig', 'multisig']]) {
        const template = fs.readFileSync(path.join(__dirname, `../browser-client/src/${html}.html`), 'utf8');
        assert.doesNotMatch(template, new RegExp(`<script[^>]*src=["']${script}\\.js`));
    }
});

test('HTML templates contain no inline event handlers, so the CSP can forbid inline script', () => {
    for (const html of ['index', 'multisig']) {
        const template = fs.readFileSync(path.join(__dirname, `../browser-client/src/${html}.html`), 'utf8');
        assert.doesNotMatch(template, /\son[a-z]+\s*=/i, `${html}.html`);
        assert.doesNotMatch(template, /<script(?![^>]*\bsrc=)[^>]*>/i, `${html}.html has no inline script blocks`);
    }
});

test('the build sets a strict Content Security Policy without eval in production', () => {
    const config = fs.readFileSync(path.join(__dirname, '../browser-client/webpack.config.js'), 'utf8');
    assert.match(config, /"default-src 'none'"/);
    assert.match(config, /"script-src 'self' 'wasm-unsafe-eval'" \+ \(mode === 'development'/);
    assert.match(config, /meta: cspMeta/);
    assert.match(config, /process\.env\.NODE_ENV === 'development' \? 'development' : 'production'/);
});

test('multisig buttons are wired by script, not inline attributes', async () => {
    const b = browser();
    b.get('createBtn').dispatch('click');
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(b.calls.requests.some(call => call.url.endsWith('/multisig/create')), 'create button creates the agreement');
    vm.runInContext('signerUnlocked = false; signerSecret = null;', b.context);
    b.get('scanBtn').dispatch('click');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(b.calls.unlocks, 1, 'sign button unlocks the passkey');
});
