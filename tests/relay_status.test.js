const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { PublicKey } = require('@solana/web3.js');
const { programId, contractHash, prefundedAccount, multisigAccount } = require('./helpers/account_fixtures');

const filename = path.join(__dirname, '../relay/server.js');
const nativeRequire = createRequire(filename);
const validHash = JSON.stringify(Array.from(contractHash));
const [expectedMultisig] = PublicKey.findProgramAddressSync([Buffer.from('oblivia_multisig'), contractHash], programId);

// Execute the actual registered route with real account decoding, but no server,
// environment-file loading, sponsor, wallet, transaction, or network access.
function relayStatus(accountLookup = async () => null) {
    const routes = new Map();
    const middleware = [];
    const calls = [];
    const app = {
        use(...handlers) { middleware.push(...handlers.filter(handler => typeof handler === 'function')); },
        get(route, ...handlers) { routes.set(route, handlers.at(-1)); },
        post() {}, listen() {},
    };
    const express = Object.assign(() => app, { json() {}, static() {} });
    const context = vm.createContext({
        require: name => name === 'express' ? express : name === 'dotenv' ? { config() {} } : nativeRequire(name),
        __dirname: path.dirname(filename), process: { env: {} }, Buffer, console: { log() {}, error() {} }, calls, accountLookup,
    });
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context);
    vm.runInContext(`
        getProgram = () => { calls.push('sponsor'); throw new Error('Status lookup must not load the sponsor'); };
        connection.getAccountInfo = async address => { calls.push(address.toBase58()); return accountLookup(address); };
    `, context);
    async function capture(run) {
        let status = 200;
        let body;
        const res = {
            status(code) { status = code; return this; },
            json(value) { body = value; return this; },
        };
        await run(res);
        // Strip cross-realm prototypes so value comparisons match JSON over HTTP.
        return { status, body: body === undefined ? undefined : JSON.parse(JSON.stringify(body)) };
    }
    return {
        calls,
        get(hash = validHash) {
            return capture(res => routes.get('/multisig/status/:hash')({ params: { hash } }, res));
        },
        parsingError(error) {
            const handler = middleware.find(fn => fn.length === 4);
            assert.ok(handler, 'relay must install JSON error-response middleware');
            return capture(res => handler(error, {}, res, () => assert.fail('unhandled parser error')));
        },
    };
}

test('multisig status requires exactly 32 integer bytes before any sponsor or RPC work', async () => {
    const invalidHashes = [
        'not-json', '', '{', 'undefined', JSON.stringify(null), JSON.stringify({}), JSON.stringify(32),
        JSON.stringify('a'.repeat(32)), JSON.stringify([]), JSON.stringify(Array(31).fill(1)),
        JSON.stringify(Array(33).fill(1)), JSON.stringify(Array(32).fill(-1)),
        JSON.stringify(Array(32).fill(256)), JSON.stringify(Array(32).fill(0.5)),
        JSON.stringify(Array(32).fill('1')), JSON.stringify(Array(32).fill(null)), JSON.stringify(Array(32)),
    ];
    for (const hash of invalidHashes) {
        const r = relayStatus();
        const response = await r.get(hash);
        assert.equal(response.status, 400, hash);
        assert.equal(typeof response.body.error, 'string');
        assert.equal(response.body.exists, undefined, 'malformed input does not prove account absence');
        assert.deepEqual(r.calls, [], hash);
    }
});

test('multisig status returns only confirmed account absence as HTTP 404 without requiring a sponsor', async () => {
    for (const info of [null, prefundedAccount()]) {
        const r = relayStatus(async () => info);
        const response = await r.get();
        assert.equal(response.status, 404);
        assert.deepEqual(response.body, { error: 'Multisig agreement not found', exists: false });
        assert.deepEqual(r.calls, [expectedMultisig.toBase58()]);
    }
});

test('multisig status reads validated public state without a configured sponsor and preserves response names', async () => {
    for (const overrides of [{ signatures_collected: 1 }, { signatures_collected: 2, finalized: true }]) {
        const account = await multisigAccount(overrides);
        const r = relayStatus(async address => {
            assert.equal(address.toBase58(), expectedMultisig.toBase58());
            return account;
        });
        const response = await r.get();
        assert.equal(response.status, 200);
        assert.deepEqual(response.body, {
            collected: overrides.signatures_collected, threshold: 2, maxSigners: 3, finalized: !!overrides.finalized,
        });
        assert.deepEqual(r.calls, [expectedMultisig.toBase58()]);
    }
});

test('multisig status does not report RPC failure, foreign accounts, or malformed state as nonexistent', async () => {
    const valid = await multisigAccount();
    const invalidAccounts = [
        { ...valid, owner: PublicKey.default }, { ...valid, executable: true },
        { ...valid, data: valid.data.subarray(0, 8) }, { ...valid, data: Buffer.alloc(valid.data.length) },
        await multisigAccount({ contract: PublicKey.default }), await multisigAccount({ threshold: 0 }),
        await multisigAccount({ signatures_collected: 4 }), await multisigAccount({ max_signers: 1 }),
    ];
    const upstream = relayStatus(async () => { throw new Error('RPC unavailable'); });
    for (const r of [upstream, ...invalidAccounts.map(info => relayStatus(async () => info))]) {
        const response = await r.get();
        assert.equal(response.status, 502);
        assert.equal(typeof response.body.error, 'string');
        assert.equal(response.body.exists, undefined);
        assert.equal(response.body.collected, undefined);
        assert.deepEqual(r.calls, [expectedMultisig.toBase58()]);
    }
});

test('body-parser failures use JSON error responses without echoing request bodies', async () => {
    for (const [type, status] of [
        ['entity.parse.failed', 400], ['entity.too.large', 413],
        ['charset.unsupported', 415], ['encoding.unsupported', 415],
        [undefined, 400], ['request.aborted', 400], ['request.size.invalid', 400],
    ]) {
        const marker = 'SENSITIVE_REQUEST_CONTENT_MUST_NOT_BE_ECHOED';
        const error = Object.assign(new Error(marker), { type, status, body: marker });
        const r = relayStatus();
        const response = await r.parsingError(error);
        assert.equal(response.status, status);
        assert.equal(typeof response.body.error, 'string');
        assert.doesNotMatch(response.body.error, new RegExp(marker));
        assert.deepEqual(r.calls, []);
    }
});
