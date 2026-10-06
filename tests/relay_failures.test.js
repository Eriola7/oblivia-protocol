const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { Keypair } = require('@solana/web3.js');
const { contractPda, prefundedAccount, contractAccount, multisigAccount } = require('./helpers/account_fixtures');

const filename = path.join(__dirname, '../relay/server.js');
const nativeRequire = createRequire(filename);
const transaction = '2'.repeat(88);

function payload() {
    return {
        contractHash: Array(32).fill(1), keyCommitment: '02'.repeat(32), signatureCommitment: '03'.repeat(32),
        proofA: Array(64).fill(0), proofB: Array(128).fill(0), proofC: Array(64).fill(0), publicInputs: Array(128).fill(0),
    };
}

function relay({ statusFails = false, submitFails = false, accountLookup = async () => null, transact = async () => transaction, mockSponsor = true, env = {}, programFailure = null } = {}) {
    const routes = new Map();
    const app = { use() {}, get() {}, post(route, ...handlers) { routes.set(route, handlers.at(-1)); }, listen() {} };
    const express = Object.assign(() => app, { json() {}, static() {} });
    const payer = Keypair.generate(); // Ephemeral test key; never funded or submitted.
    const calls = [];
    const method = name => (...args) => ({ accounts: () => {
        const builder = {
            signers: () => builder,
            rpc: async () => { calls.push(name); return transact(name, args); },
            instruction: async () => ({ keys: [], programId: payer.publicKey, data: Buffer.alloc(0) }),
        };
        if (name === 'verify') assert.deepEqual(args.slice(0, 4).map(bytes => bytes.length), [64, 128, 64, 128]);
        return builder;
    } });
    const program = {
        methods: { registerContract: method('register'), createMultisig: method('create'), verifyGroth16V2: method('verify'), recordVerifiedMultisig: method('record') },
        provider: { sendAndConfirm: async () => {
            if (submitFails) throw new Error('submission failed');
            calls.push('confirmed');
            return transaction;
        } },
        account: { multiSigContract: { fetch: async () => {
            calls.push('status');
            if (statusFails) throw new Error('RPC state fetch unavailable');
            return { signaturesCollected: 2, threshold: 2, finalized: true };
        } } },
    };
    const context = vm.createContext({
        require: name => name === 'express' ? express : name === 'dotenv' ? { config() {} } : nativeRequire(name),
        __dirname: path.dirname(filename), process: { env }, Buffer, console: { log() {}, error() {} }, program, payer, calls, accountLookup, programFailure,
    });
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context);
    if (mockSponsor) vm.runInContext('getProgram = () => { calls.push("program"); if (programFailure) throw programFailure; return { program, keypair: payer }; };', context);
    vm.runInContext(`
        connection.getAccountInfo = async address => { calls.push('account lookup'); return accountLookup(address); };
    `, context);
    async function postResponse(route, body) {
        let response;
        let status = 200;
        const res = {
            status(code) { status = code; return this; },
            json(value) { response = value; return this; },
        };
        await routes.get(route)({ body }, res);
        return { status, body: response };
    }
    return {
        calls,
        postResponse,
        async post(route, body) {
            return (await postResponse(route, body)).body;
        },
    };
}

test('single-sign relay rejects every malformed proof field before touching accounts or the sponsor', async () => {
    for (const field of ['proofA', 'proofB', 'proofC', 'publicInputs']) {
        for (const invalid of [[], undefined, 'bad', Array(payload()[field].length).fill(256), Array(payload()[field].length).fill(0.5)]) {
            const r = relay();
            const response = await r.postResponse('/sign', { ...payload(), [field]: invalid });
            assert.equal(response.status, 400);
            assert.match(response.body.error, new RegExp(field + ' must be an array'));
            assert.deepEqual(r.calls, []);
        }
    }
});

test('well-shaped single-sign payload still registers and then verifies', async () => {
    const r = relay();
    const response = await r.post('/sign', payload());
    assert.equal(response.transaction, transaction);
    assert.deepEqual(r.calls, ['program', 'account lookup', 'register', 'verify']);
});

test('single-sign relay initializes a prefunded system-owned contract PDA', async () => {
    const r = relay({ accountLookup: async () => prefundedAccount() });
    const response = await r.post('/sign', payload());
    assert.equal(response.transaction, transaction);
    assert.deepEqual(r.calls, ['program', 'account lookup', 'register', 'verify']);
});

test('relay reuses valid accounts but rejects foreign or malformed contract accounts before transactions', async () => {
    const initialized = await contractAccount();
    const r = relay({ accountLookup: async () => initialized });
    assert.equal((await r.post('/sign', payload())).transaction, transaction);
    assert.deepEqual(r.calls, ['program', 'account lookup', 'verify']);
    for (const invalid of [
        { ...initialized, owner: Keypair.generate().publicKey },
        { ...initialized, executable: true },
        { ...initialized, data: initialized.data.subarray(0, 8) },
        { ...initialized, data: Buffer.alloc(initialized.data.length) },
        await contractAccount({ contract_hash: Array(32).fill(7) }),
    ]) {
        const failed = relay({ accountLookup: async () => invalid });
        assert.match((await failed.post('/sign', payload())).error, /account|owner/i);
        assert.deepEqual(failed.calls, ['program', 'account lookup']);
    }
});

test('concurrent first signers recover a registration race and both reach proof verification', async () => {
    const initialized = await contractAccount();
    let stored = null;
    let arrivals = 0;
    let release;
    const barrier = new Promise(resolve => { release = resolve; });
    const r = relay({
        accountLookup: async () => {
            const observed = stored;
            if (!observed) {
                if (++arrivals === 2) release();
                await barrier;
            }
            return observed;
        },
        transact: async name => {
            if (name === 'register') {
                if (stored) throw new Error('account already in use');
                stored = initialized;
            }
            return transaction;
        },
    });
    const responses = await Promise.all([
        r.post('/sign', payload()),
        r.post('/sign', { ...payload(), keyCommitment: '04'.repeat(32) }),
    ]);
    for (const response of responses) assert.equal(response.transaction, transaction);
    assert.equal(r.calls.filter(call => call === 'register').length, 2, 'one registration attempt per request');
    assert.equal(r.calls.filter(call => call === 'verify').length, 2);
});

test('single-sign registration failure remains a failure without a valid race winner', async () => {
    const original = new Error('registration denied');
    const initialized = await contractAccount();
    for (const recovery of [
        null, prefundedAccount(), 'lookup failure',
        { ...initialized, owner: Keypair.generate().publicKey },
        { ...initialized, data: Buffer.alloc(initialized.data.length) },
        await contractAccount({ contract_hash: Array(32).fill(9) }),
    ]) {
        let reads = 0;
        const r = relay({
            accountLookup: async () => {
                if (++reads === 1) return null;
                if (recovery === 'lookup failure') throw new Error('lookup unavailable');
                return recovery;
            },
            transact: async () => { throw original; },
        });
        const response = await r.post('/sign', payload());
        assert.match(response.error, /registration denied|owner|account/i);
        assert.equal(response.transaction, undefined);
        assert.equal(reads, 2);
        assert.equal(r.calls.filter(call => call === 'register').length, 1);
        assert.ok(!r.calls.includes('verify'));
    }
});

test('multisig creation recovers concurrent contract and multisig initialization without inventing a receipt', async () => {
    const contract = await contractAccount();
    const multisig = await multisigAccount();
    for (const preinitializedContract of [false, true]) {
        const stored = { contract: preinitializedContract ? contract : null, multisig: null };
        const barriers = Object.fromEntries(['contract', 'multisig'].map(kind => {
            let release;
            const promise = new Promise(resolve => { release = resolve; });
            return [kind, { arrivals: 0, release, promise }];
        }));
        const r = relay({
            accountLookup: async address => {
                const kind = address.equals(contractPda) ? 'contract' : 'multisig';
                const observed = stored[kind];
                if (!observed) {
                    if (++barriers[kind].arrivals === 2) barriers[kind].release();
                    await barriers[kind].promise;
                }
                return observed;
            },
            transact: async name => {
                const kind = name === 'register' ? 'contract' : 'multisig';
                if (stored[kind]) throw new Error('account already in use');
                stored[kind] = kind === 'contract' ? contract : multisig;
                return transaction;
            },
        });
        const body = { contractHash: payload().contractHash, threshold: 2, maxSigners: 3 };
        const responses = await Promise.all([r.post('/multisig/create', body), r.post('/multisig/create', body)]);
        assert.equal(responses.filter(response => response.transaction === transaction).length, 1);
        const recovered = responses.find(response => response.alreadyExists);
        assert.ok(recovered);
        assert.equal(recovered.transaction, undefined);
        assert.equal(recovered.explorer, undefined);
        assert.equal(responses[0].multisig, responses[1].multisig);
        assert.equal(r.calls.filter(call => call === 'register').length, preinitializedContract ? 0 : 2);
        assert.equal(r.calls.filter(call => call === 'create').length, 2);
    }
});

test('multisig creation cannot recover absent, malformed, foreign or conflicting race winners', async () => {
    const contract = await contractAccount();
    const multisig = await multisigAccount();
    for (const recovery of [
        null, prefundedAccount(), 'lookup failure',
        { ...multisig, owner: Keypair.generate().publicKey },
        { ...multisig, data: Buffer.alloc(multisig.data.length) },
        await multisigAccount({ contract: Keypair.generate().publicKey }),
        await multisigAccount({ threshold: 1 }),
        await multisigAccount({ max_signers: 4 }),
    ]) {
        let reads = 0;
        const r = relay({
            accountLookup: async address => {
                if (address.equals(contractPda)) return contract;
                if (++reads === 1) return null;
                if (recovery === 'lookup failure') throw new Error('lookup unavailable');
                return recovery;
            },
            transact: async () => { throw new Error('creation denied'); },
        });
        const response = await r.post('/multisig/create', { contractHash: payload().contractHash, threshold: 2, maxSigners: 3 });
        assert.match(response.error, /creation denied|owner|account|different multisig settings/i);
        assert.equal(response.alreadyExists, undefined);
        assert.equal(response.transaction, undefined);
        assert.equal(reads, 2);
        assert.equal(r.calls.filter(call => call === 'create').length, 1);
        assert.ok(!r.calls.includes('register'));
    }
});

test('multisig relay initializes absent or prefunded contract and multisig PDAs', async () => {
    for (const info of [null, prefundedAccount()]) {
        const r = relay({ accountLookup: async () => info });
        const response = await r.post('/multisig/create', { contractHash: payload().contractHash, threshold: 2, maxSigners: 3 });
        assert.equal(response.transaction, transaction);
        assert.equal(response.alreadyExists, undefined);
        assert.deepEqual(r.calls, ['program', 'account lookup', 'account lookup', 'register', 'create']);
    }
});

test('multisig relay validates the existing multisig before spending contract registration rent', async () => {
    const valid = await multisigAccount();
    for (const invalid of [
        { ...valid, owner: Keypair.generate().publicKey },
        { ...valid, data: Buffer.alloc(valid.data.length) },
        await multisigAccount({ threshold: 1 }),
    ]) {
        const r = relay({ accountLookup: async address => address.equals(contractPda) ? prefundedAccount() : invalid });
        const response = await r.post('/multisig/create', { contractHash: payload().contractHash, threshold: 2, maxSigners: 3 });
        assert.ok(response.error);
        assert.deepEqual(r.calls, ['program', 'account lookup', 'account lookup']);
    }
});

test('multisig relay preserves a confirmed receipt when the subsequent state read fails', async () => {
    const r = relay({ statusFails: true });
    const result = await r.postResponse('/multisig/sign', payload());
    assert.equal(result.status, 200);
    const response = result.body;
    assert.equal(response.transaction, transaction);
    assert.equal(response.statusUnavailable, true);
    assert.equal(response.error, undefined);
    assert.equal(response.collected, undefined);
    assert.equal(response.finalized, undefined, 'do not invent a threshold result');
    assert.equal(response.explorer, `https://explorer.solana.com/tx/${transaction}?cluster=devnet`);
    assert.deepEqual(r.calls, ['program', 'confirmed', 'status']);
});

test('every sponsored endpoint rejects invalid bodies before loading the sponsor or reading accounts', async () => {
    for (const route of ['/sign', '/multisig/create', '/multisig/sign']) {
        for (const body of [undefined, null, [], 'not an object', 7, true]) {
            const r = relay();
            const response = await r.postResponse(route, body);
            assert.equal(response.status, 400, route);
            assert.equal(typeof response.body.error, 'string');
            assert.deepEqual(r.calls, [], route);
        }
    }
});

test('all signing fields reject malformed bytes and commitments before sponsor or RPC calls', async () => {
    for (const route of ['/sign', '/multisig/sign']) {
        for (const field of ['contractHash', 'proofA', 'proofB', 'proofC', 'publicInputs']) {
            const size = payload()[field].length;
            const invalidValues = [null, '01'.repeat(size), Array(size - 1).fill(0), Array(size + 1).fill(0),
                Array(size).fill(-1), Array(size).fill(256), Array(size).fill(0.5), Array(size).fill(null), Array(size)];
            for (const invalid of invalidValues) {
                const r = relay();
                const response = await r.postResponse(route, { ...payload(), [field]: invalid });
                assert.equal(response.status, 400, `${route}: ${field}`);
                assert.match(response.body.error, new RegExp(field));
                assert.deepEqual(r.calls, [], `${route}: ${field}`);
            }
        }
        for (const field of ['keyCommitment', 'signatureCommitment']) {
            for (const invalid of [null, [], 7, 'ab'.repeat(31), 'ab'.repeat(33), 'zz'.repeat(32)]) {
                const r = relay();
                const response = await r.postResponse(route, { ...payload(), [field]: invalid });
                assert.equal(response.status, 400, `${route}: ${field}`);
                assert.match(response.body.error, new RegExp(field));
                assert.deepEqual(r.calls, [], `${route}: ${field}`);
            }
        }
    }
});

test('multisig creation uses HTTP 400 for invalid configuration and 409 for existing policy conflicts', async () => {
    const validBody = { contractHash: payload().contractHash, threshold: 2, maxSigners: 3 };
    for (const overrides of [{ threshold: 0 }, { threshold: 2.5 }, { threshold: '2' }, { threshold: 4 },
        { maxSigners: 256 }, { maxSigners: 1 }, { maxSigners: null }, { contractHash: Array(33).fill(1) }]) {
        const r = relay();
        const response = await r.postResponse('/multisig/create', { ...validBody, ...overrides });
        assert.equal(response.status, 400);
        assert.equal(typeof response.body.error, 'string');
        assert.deepEqual(r.calls, []);
    }
    const contract = await contractAccount();
    const conflicting = await multisigAccount({ threshold: 1 });
    const r = relay({ accountLookup: async address => address.equals(contractPda) ? contract : conflicting });
    const response = await r.postResponse('/multisig/create', validBody);
    assert.equal(response.status, 409);
    assert.match(response.body.error, /different multisig settings/);
    assert.deepEqual(r.calls, ['program', 'account lookup', 'account lookup']);
});

test('misconfigured sponsors return sanitized HTTP 503 without touching RPC', async () => {
    for (const env of [{}, { OBLIVIA_DEVNET_KEY: 'INVALID_DUMMY_SECRET_MUST_NOT_BE_ECHOED' }]) {
        for (const [route, body] of [['/sign', payload()], ['/multisig/sign', payload()],
            ['/multisig/create', { contractHash: payload().contractHash, threshold: 2, maxSigners: 3 }]]) {
            const r = relay({ mockSponsor: false, env });
            const response = await r.postResponse(route, body);
            assert.equal(response.status, 503);
            assert.equal(typeof response.body.error, 'string');
            assert.doesNotMatch(response.body.error, /INVALID_DUMMY_SECRET|secret key|Buffer|undefined/);
            assert.deepEqual(r.calls, []);
        }
    }
});

test('upstream failures are HTTP 502 regardless of their message and unexpected local failures stay HTTP 500', async () => {
    const upstream = new TypeError('fetch failed');
    upstream.cause = Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
    for (const error of [upstream, new Error('arbitrary upstream message')]) {
        const r = relay({ accountLookup: async () => { throw error; } });
        const response = await r.postResponse('/sign', payload());
        assert.equal(response.status, 502);
        assert.equal(typeof response.body.error, 'string');
        assert.equal(response.body.transaction, undefined);
        assert.deepEqual(r.calls, ['program', 'account lookup']);
    }
    const r = relay({ programFailure: new Error('unexpected private implementation detail') });
    const response = await r.postResponse('/sign', payload());
    assert.equal(response.status, 500);
    assert.equal(response.body.error, 'Relay request failed');
    assert.deepEqual(r.calls, ['program']);
});

test('multisig relay still returns valid threshold state and distinguishes a failed submission', async () => {
    const success = await relay().post('/multisig/sign', payload());
    assert.equal(success.transaction, transaction);
    assert.equal(success.collected, 2);
    assert.equal(success.threshold, 2);
    assert.equal(success.finalized, true);
    const failed = relay({ submitFails: true });
    const response = await failed.post('/multisig/sign', payload());
    assert.match(response.error, /submission failed/);
    assert.equal(response.transaction, undefined);
    assert.equal(response.statusUnavailable, undefined);
    assert.deepEqual(failed.calls, ['program']);
});
