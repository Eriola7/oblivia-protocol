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

function relay({ statusFails = false, submitFails = false, accountLookup = async () => null, transact = async () => transaction } = {}) {
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
        __dirname: path.dirname(filename), process: { env: {} }, Buffer, console: { log() {} }, program, payer, calls, accountLookup,
    });
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context);
    vm.runInContext(`
        getProgram = () => { calls.push('program'); return { program, keypair: payer }; };
        connection.getAccountInfo = async address => { calls.push('account lookup'); return accountLookup(address); };
    `, context);
    return {
        calls,
        async post(route, body) {
            let response;
            await routes.get(route)({ body }, { json: value => { response = value; } });
            return response;
        },
    };
}

test('single-sign relay rejects every malformed proof field before touching accounts or the sponsor', async () => {
    for (const field of ['proofA', 'proofB', 'proofC', 'publicInputs']) {
        for (const invalid of [[], undefined, 'bad', Array(payload()[field].length).fill(256), Array(payload()[field].length).fill(0.5)]) {
            const r = relay();
            const response = await r.post('/sign', { ...payload(), [field]: invalid });
            assert.match(response.error, new RegExp(field + ' must be an array'));
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
    const response = await r.post('/multisig/sign', payload());
    assert.equal(response.transaction, transaction);
    assert.equal(response.statusUnavailable, true);
    assert.equal(response.error, undefined);
    assert.equal(response.collected, undefined);
    assert.equal(response.finalized, undefined, 'do not invent a threshold result');
    assert.equal(response.explorer, `https://explorer.solana.com/tx/${transaction}?cluster=devnet`);
    assert.deepEqual(r.calls, ['program', 'confirmed', 'status']);
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
