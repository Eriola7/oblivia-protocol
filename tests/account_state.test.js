const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { Keypair } = require('@solana/web3.js');
const { createAccountReaders, initializeOrReadExisting } = require('../sdk/lib/account_state');
const { readContractAccount, readMultisigAccount } = createAccountReaders(require('@coral-xyz/anchor'));
const { contractHash, contractPda, prefundedAccount, contractAccount, multisigAccount } = require('./helpers/account_fixtures');

test('shared account reader uses the caller Anchor dependency, including relay-only installs', () => {
    const filename = path.join(__dirname, '../sdk/lib/account_state.js');
    const localRequire = createRequire(filename);
    const context = vm.createContext({
        require(name) {
            assert.ok(name.startsWith('./'), 'shared helper must not resolve packages from SDK node_modules');
            return localRequire(name);
        },
        module: { exports: {} }, Buffer,
    });
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context);
    const relayRequire = createRequire(path.join(__dirname, '../relay/server.js'));
    const readers = context.module.exports.createAccountReaders(relayRequire('@coral-xyz/anchor'));
    assert.equal(readers.readContractAccount(prefundedAccount(), contractHash), null);
});

test('account checks distinguish uninitialized PDAs from real contract-bound account data', async () => {
    for (const info of [null, prefundedAccount()]) {
        assert.equal(readContractAccount(info, contractHash), null);
        assert.equal(readMultisigAccount(info, contractPda), null);
    }
    assert.equal(readContractAccount(await contractAccount(), contractHash).active, true);
    assert.equal(readMultisigAccount(await multisigAccount(), contractPda).maxSigners, 3);
    assert.throws(() => readContractAccount({ ...prefundedAccount(), data: Buffer.alloc(1) }, contractHash), /owner/);
    assert.throws(() => readContractAccount({}, contractHash), /metadata/);
    assert.throws(() => readContractAccount({ ...prefundedAccount(), executable: true }, contractHash), /metadata/);
    assert.throws(() => readMultisigAccount({ ...prefundedAccount(), owner: Keypair.generate().publicKey }, contractPda), /owner/);
});

test('account decoder rejects mismatched types, truncated data and inconsistent bindings', async () => {
    const contract = await contractAccount();
    const multisig = await multisigAccount();
    for (const info of [
        { ...contract, data: Buffer.alloc(contract.data.length) },
        { ...contract, data: contract.data.subarray(0, -1) },
        { ...contract, data: Buffer.concat([contract.data, Buffer.alloc(1)]) },
        await contractAccount({ contract_hash: Array(32).fill(2) }),
        multisig,
    ]) assert.throws(() => readContractAccount(info, contractHash), /account/i);
    for (const info of [
        { ...multisig, data: Buffer.alloc(multisig.data.length) },
        { ...multisig, data: multisig.data.subarray(0, -1) },
        await multisigAccount({ contract: Keypair.generate().publicKey }),
        await multisigAccount({ threshold: 0 }),
        await multisigAccount({ signatures_collected: 4 }),
        contract,
    ]) assert.throws(() => readMultisigAccount(info, contractPda), /account|integer|count/i);
});

test('initialization recovery reads once after failure and never fabricates a receipt', async () => {
    const original = new Error('initialization failed');
    let sends = 0;
    let reads = 0;
    const options = {
        initialize: async () => { sends++; throw original; },
        fetchAccount: async () => { reads++; return contractAccount(); },
        readAccount: info => readContractAccount(info, contractHash),
    };
    assert.equal(await initializeOrReadExisting(options), null);
    assert.equal(sends, 1);
    assert.equal(reads, 1);
    assert.equal(await initializeOrReadExisting({ ...options, initialize: async () => 'real-transaction' }), 'real-transaction');
    assert.equal(reads, 1, 'successful initialization needs no recovery lookup');
    for (const info of [null, prefundedAccount()]) {
        await assert.rejects(initializeOrReadExisting({ ...options, fetchAccount: async () => info }), error => error === original);
    }
    await assert.rejects(initializeOrReadExisting({ ...options, fetchAccount: async () => { throw new Error('lookup failed'); } }), error => error === original);
    const malformed = { ...await contractAccount(), data: Buffer.alloc(1) };
    await assert.rejects(initializeOrReadExisting({ ...options, fetchAccount: async () => malformed }), /Invalid Contract account size/);
});

function anchorHelper(file, accountLookup, transact = async name => name + '-transaction') {
    const filename = path.join(__dirname, '..', file);
    const nativeRequire = createRequire(filename);
    const calls = [];
    const payer = Keypair.generate(); // Offline, synthetic payer only.
    const method = name => (...args) => ({ accounts: () => {
        const builder = { signers: () => builder, rpc: async () => { calls.push(name); return transact(name, args); } };
        return builder;
    } });
    const program = { methods: { registerContract: method('register'), createMultisig: method('create') } };
    const context = vm.createContext({
        require: name => name === 'dotenv' ? { config() {} } : nativeRequire(name),
        module: { exports: {} }, __dirname: path.dirname(filename), Buffer,
        process: { env: {} }, console: { log() {} }, payer, program, accountLookup,
    });
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context);
    vm.runInContext(`
        getKeypair = () => payer; getProvider = () => ({}); getProgram = async () => program;
        connection.getAccountInfo = accountLookup;
    `, context);
    return { methods: context.module.exports, calls };
}

for (const file of ['anchor_integration.js', 'sdk/lib/anchor_integration.js']) {
    test(file + ' recovers concurrent initialization with exact accounts and no invented transaction', async () => {
        for (const operation of ['register', 'create']) {
            const initialized = operation === 'register' ? await contractAccount() : await multisigAccount();
            let stored = null;
            let arrivals = 0;
            let release;
            const barrier = new Promise(resolve => { release = resolve; });
            const lookup = async () => {
                const observed = stored;
                if (!observed) {
                    if (++arrivals === 2) release();
                    await barrier;
                }
                return observed;
            };
            const transact = async name => {
                assert.equal(name, operation);
                if (stored) throw new Error('account already in use');
                stored = initialized;
                return 'winning-initialization';
            };
            // Independent synthetic payers model different registration
            // transactions, not identical-transaction RPC deduplication.
            const clients = [anchorHelper(file, lookup, transact), anchorHelper(file, lookup, transact)];
            const results = await Promise.all(clients.map(client => operation === 'register'
                ? client.methods.registerContract(contractHash)
                : client.methods.createMultisig(contractHash, 2, 3)));
            assert.deepEqual(results.map(result => result.tx).sort(), [null, 'winning-initialization'].sort());
            for (const client of clients) assert.deepEqual(client.calls, [operation], 'only one send per client');
        }
    });

    test(file + ' preserves genuine initialization failures and rejects conflicting race winners', async () => {
        const original = new Error('sponsor could not initialize');
        for (const operation of ['register', 'create']) {
            const malformed = { ...await contractAccount(), owner: Keypair.generate().publicKey };
            const conflicting = operation === 'register'
                ? await contractAccount({ contract_hash: Array(32).fill(9) })
                : await multisigAccount({ threshold: 1 });
            for (const recovery of [null, prefundedAccount(), 'lookup failure', malformed, conflicting]) {
                let reads = 0;
                const helper = anchorHelper(file, async () => {
                    if (++reads === 1) return null;
                    if (recovery === 'lookup failure') throw new Error('RPC unavailable');
                    return recovery;
                }, async () => { throw original; });
                const result = operation === 'register'
                    ? helper.methods.registerContract(contractHash)
                    : helper.methods.createMultisig(contractHash, 2, 3);
                if (recovery === malformed || recovery === conflicting) {
                    await assert.rejects(result, /owner|does not match|different multisig settings/);
                } else {
                    await assert.rejects(result, error => error === original);
                }
                assert.equal(reads, 2);
                assert.deepEqual(helper.calls, [operation]);
            }
        }
    });

    test(file + ' initializes prefunded PDAs and only reuses decoded initialized accounts', async () => {
        for (const info of [null, prefundedAccount()]) {
            const helper = anchorHelper(file, async () => info);
            assert.equal((await helper.methods.registerContract(contractHash)).tx, 'register-transaction');
            assert.equal((await helper.methods.createMultisig(contractHash, 2, 3)).tx, 'create-transaction');
            assert.deepEqual(helper.calls, ['register', 'create']);
        }
        const contract = await contractAccount();
        const multisig = await multisigAccount();
        const helper = anchorHelper(file, async address => address.equals(contractPda) ? contract : multisig);
        assert.equal((await helper.methods.registerContract(contractHash)).tx, null);
        assert.equal((await helper.methods.createMultisig(contractHash, 2, 3)).tx, null);
        assert.deepEqual(helper.calls, []);
    });

    test(file + ' rejects malformed or foreign accounts instead of returning false success', async () => {
        const contract = await contractAccount();
        const multisig = await multisigAccount();
        for (const info of [
            { ...prefundedAccount(), owner: Keypair.generate().publicKey },
            { ...contract, data: Buffer.alloc(contract.data.length) },
            { ...multisig, data: multisig.data.subarray(0, 8) },
        ]) {
            const helper = anchorHelper(file, async () => info);
            await assert.rejects(helper.methods.registerContract(contractHash), /account|owner/i);
            await assert.rejects(helper.methods.createMultisig(contractHash, 2, 3), /account|owner/i);
            assert.deepEqual(helper.calls, []);
        }
    });
}
