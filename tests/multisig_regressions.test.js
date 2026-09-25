const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { validateMultisigConfig, assertMultisigConfig } = require('../sdk/lib/multisig_config');
const root = path.join(__dirname, '..');

test('multisig configuration rejects invalid and conflicting settings', () => {
    for (const args of [[0, 2], [-1, 2], [3, 2], [1, 256], [1.5, 2], [1, 2.5], ['2', 3], [NaN, 3]]) {
        assert.throws(() => validateMultisigConfig(...args));
    }
    assert.doesNotThrow(() => validateMultisigConfig(1, 255));
    assert.doesNotThrow(() => assertMultisigConfig({ threshold: 2, maxSigners: 3 }, 2, 3));
    assert.throws(() => assertMultisigConfig({ threshold: 1, maxSigners: 3 }, 2, 3), /different multisig settings/);
    assert.throws(() => assertMultisigConfig({ threshold: 2, maxSigners: 4 }, 2, 3), /different multisig settings/);
});

test('actual browser share-link handler preserves exact contract bytes', async () => {
    for (const contract of ['Pay 10%', 'Pay %41', 'literal %E0%A4%A', 'A+B & C', 'Agreement 📝\n第二条']) {
        let loaded;
        const elements = new Map();
        const context = vm.createContext({
            require(name) {
                if (name === '@noble/hashes/sha2.js') return { sha256: bytes => crypto.createHash('sha256').update(bytes).digest() };
                return {};
            },
            URLSearchParams, TextEncoder, Uint8Array, Buffer,
            window: { location: { search: '?c=' + encodeURIComponent(contract) }, addEventListener: (_, fn) => { loaded = fn; } },
            document: { getElementById(id) { if (!elements.has(id)) elements.set(id, { style: {} }); return elements.get(id); } },
            fetch: async () => ({ json: async () => ({ collected: 0, threshold: 2, finalized: false }) }),
        });
        vm.runInContext(fs.readFileSync(path.join(root, 'browser-client/src/multisig.js'), 'utf8'), context);
        loaded();
        assert.equal(elements.get('contractDisplay').textContent, contract);
        assert.equal(Buffer.from(vm.runInContext('currentHash', context)).toString('hex'), crypto.createHash('sha256').update(contract).digest('hex'));
    }
});

for (const file of ['anchor_integration.js', 'sdk/lib/anchor_integration.js']) {
    test(file + ' passes verified signer record and signature and rejects existing config conflicts', async () => {
        const filename = path.join(root, file);
        const nativeRequire = createRequire(filename);
        const calls = [];
        const payer = require('@solana/web3.js').Keypair.generate();
        let existing = { threshold: 1, maxSigners: 3 };
        const method = name => () => ({ accounts(accounts) { calls.push({ name, accounts }); return { instruction: async () => ({ keys: [], programId: payer.publicKey, data: Buffer.alloc(0) }) }; } });
        const program = { methods: { verifyGroth16V2: method('verify'), recordVerifiedMultisig: method('record') }, account: { multiSigContract: { fetch: async () => existing } } };
        const provider = { sendAndConfirm: async () => 'test-transaction' };
        const context = vm.createContext({ require: name => name === 'dotenv' ? { config() {} } : nativeRequire(name), module: { exports: {} }, __dirname: path.dirname(filename), Buffer, process: { env: {} }, console: { log() {} }, payer, program, provider });
        vm.runInContext(fs.readFileSync(filename, 'utf8'), context);
        vm.runInContext('getKeypair = () => payer; getProvider = () => provider; getProgram = async () => program; connection.getAccountInfo = async () => ({});', context);
        await assert.rejects(context.module.exports.createMultisig(Array(32).fill(1), 2, 3), /different multisig settings/);
        existing = { threshold: 2, maxSigners: 3 };
        assert.equal((await context.module.exports.createMultisig(Array(32).fill(1), 2, 3)).tx, null);
        await context.module.exports.submitVerifiedMultiSig(Array(32).fill(1), { keyCommitment: Array(32).fill(2), signatureCommitment: Array(32).fill(3), proofA: [], proofB: [], proofC: [], publicInputs: [] });
        assert.equal(calls.length, 2);
        assert.equal(calls[0].name, 'verify');
        assert.equal(calls[1].name, 'record');
        assert.equal(calls[0].accounts.signerRecord.toBase58(), calls[1].accounts.signerRecord.toBase58());
        assert.equal(calls[0].accounts.signature.toBase58(), calls[1].accounts.signature.toBase58());
        const { PublicKey } = require('@solana/web3.js');
        const programId = new PublicKey(require('../sdk/lib/idl.json').address);
        const expectedSignature = PublicKey.findProgramAddressSync([
            Buffer.from('oblivia_signature'), calls[0].accounts.contract.toBuffer(),
            Buffer.alloc(32, 2), Buffer.alloc(32, 3),
        ], programId)[0];
        assert.equal(calls[1].accounts.signature.toBase58(), expectedSignature.toBase58());
    });
}

test('published IDL requires a read-only signer record and contract-bound signature', () => {
    const idl = require('../sdk/lib/idl.json');
    const generated = path.join(root, 'oblivia-contracts/target/idl/oblivia_contracts.json');
    if (fs.existsSync(generated)) assert.deepEqual(idl, JSON.parse(fs.readFileSync(generated, 'utf8')));
    const record = idl.instructions.find(ix => ix.name === 'record_verified_multisig');
    const account = record.accounts.find(a => a.name === 'signer_record');
    assert.ok(account);
    assert.equal(account.writable, undefined);
    assert.equal(Buffer.from(account.pda.seeds[0].value).toString(), 'oblivia_signer_record');
    assert.deepEqual(account.pda.seeds.slice(1), [{ kind: 'arg', path: 'contract_hash' }, { kind: 'arg', path: 'key_commitment' }]);
    const signature = record.accounts.find(a => a.name === 'signature');
    assert.ok(signature);
    assert.equal(signature.writable, undefined);
    // Anchor omits auto-resolution metadata for this self-referential PDA seed.
    // Clients supply it explicitly; the compiled program tests enforce its seeds.
    assert.ok(record.accounts.find(a => a.name === 'contract').relations.includes('signature'));
});

test('relay refuses conflicting settings and passes the proof record to counting', async () => {
    const filename = path.join(root, 'relay/server.js');
    const nativeRequire = createRequire(filename);
    const routes = new Map();
    const app = { use() {}, get() {}, post(route, ...handlers) { routes.set(route, handlers.at(-1)); }, listen() {} };
    const express = Object.assign(() => app, { json() {}, static() {} });
    const payer = require('@solana/web3.js').Keypair.generate();
    const calls = [];
    const method = name => () => ({ accounts(accounts) { calls.push({ name, accounts }); return { instruction: async () => ({ keys: [], programId: payer.publicKey, data: Buffer.alloc(0) }) }; } });
    let existing = { threshold: 1, maxSigners: 3 };
    const program = {
        methods: { verifyGroth16V2: method('verify'), recordVerifiedMultisig: method('record') },
        account: { multiSigContract: { fetch: async () => existing } },
        provider: { sendAndConfirm: async () => 'test-transaction' },
    };
    const context = vm.createContext({
        require: name => name === 'express' ? express : name === 'dotenv' ? { config() {} } : nativeRequire(name),
        __dirname: path.dirname(filename), process: { env: {} }, Buffer, console: { log() {} }, program, payer,
    });
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context);
    vm.runInContext('getProgram = () => ({ program, keypair: payer }); connection.getAccountInfo = async () => ({});', context);
    let response;
    const res = { json: body => { response = body; } };
    const contractHash = Array(32).fill(1);
    await routes.get('/multisig/create')({ body: { contractHash, threshold: 2, maxSigners: 3 } }, res);
    assert.match(response.error, /different multisig settings/);
    assert.equal(calls.length, 0);
    existing = { threshold: 2, maxSigners: 3 };
    await routes.get('/multisig/create')({ body: { contractHash, threshold: 2, maxSigners: 3 } }, res);
    assert.equal(response.alreadyExists, true);
    await routes.get('/multisig/create')({ body: { contractHash, threshold: 0, maxSigners: 3 } }, res);
    assert.match(response.error, /integer values/);
    await routes.get('/multisig/sign')({ body: { contractHash, keyCommitment: '02'.repeat(32), signatureCommitment: '03'.repeat(32), proofA: Array(64).fill(0), proofB: Array(128).fill(0), proofC: Array(64).fill(0), publicInputs: Array(128).fill(0) } }, res);
    assert.equal(response.error, undefined);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].accounts.signerRecord.toBase58(), calls[1].accounts.signerRecord.toBase58());
    assert.equal(calls[0].accounts.signature.toBase58(), calls[1].accounts.signature.toBase58());
});

test('browser prevents overlapping scans and allows retry after model failure', async () => {
    const scanBtn = { disabled: false };
    const status = {};
    let rejectModel;
    let loads = 0;
    const context = vm.createContext({
        require: () => ({}),
        window: { addEventListener() {} },
        document: { getElementById: id => id === 'scanBtn' ? scanBtn : id === 'bioStatus' ? status : null },
        failModel: () => { loads++; return new Promise((_, reject) => { rejectModel = reject; }); },
    });
    vm.runInContext(fs.readFileSync(path.join(root, 'browser-client/src/multisig.js'), 'utf8'), context);
    vm.runInContext('loadDetector = failModel', context);
    const first = context.window.captureBiometric();
    await context.window.captureBiometric();
    assert.equal(loads, 1);
    assert.equal(scanBtn.disabled, true);
    rejectModel(new Error('model unavailable'));
    await first;
    assert.equal(scanBtn.disabled, false);
    assert.equal(status.textContent, 'Error. Try again.');
});
