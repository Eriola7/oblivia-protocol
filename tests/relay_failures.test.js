const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { Keypair } = require('@solana/web3.js');

const filename = path.join(__dirname, '../relay/server.js');
const nativeRequire = createRequire(filename);
const transaction = '2'.repeat(88);

function payload() {
    return {
        contractHash: Array(32).fill(1), keyCommitment: '02'.repeat(32), signatureCommitment: '03'.repeat(32),
        proofA: Array(64).fill(0), proofB: Array(128).fill(0), proofC: Array(64).fill(0), publicInputs: Array(128).fill(0),
    };
}

function relay({ statusFails = false, submitFails = false } = {}) {
    const routes = new Map();
    const app = { use() {}, get() {}, post(route, ...handlers) { routes.set(route, handlers.at(-1)); }, listen() {} };
    const express = Object.assign(() => app, { json() {}, static() {} });
    const payer = Keypair.generate(); // Ephemeral test key; never funded or submitted.
    const calls = [];
    const method = name => (...args) => ({ accounts: () => {
        const builder = {
            signers: () => builder,
            rpc: async () => { calls.push(name); return transaction; },
            instruction: async () => ({ keys: [], programId: payer.publicKey, data: Buffer.alloc(0) }),
        };
        if (name === 'verify') assert.deepEqual(args.slice(0, 4).map(bytes => bytes.length), [64, 128, 64, 128]);
        return builder;
    } });
    const program = {
        methods: { registerContract: method('register'), verifyGroth16V2: method('verify'), recordVerifiedMultisig: method('record') },
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
        __dirname: path.dirname(filename), process: { env: {} }, Buffer, console: { log() {} }, program, payer, calls,
    });
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context);
    vm.runInContext(`
        getProgram = () => { calls.push('program'); return { program, keypair: payer }; };
        connection.getAccountInfo = async () => { calls.push('account lookup'); return null; };
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
