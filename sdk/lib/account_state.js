const idl = require('./idl.json');
const { validateMultisigConfig } = require('./multisig_config');

// Receive Anchor from the caller so relay-only installs do not need an SDK or
// root node_modules directory to resolve this shared helper's dependencies.
function createAccountReaders(anchor) {
    const { PublicKey, SystemProgram } = anchor.web3;
    const programId = new PublicKey(idl.address);
    const coder = new anchor.BorshAccountsCoder(idl);

    // A PDA can have lamports before initialization: anyone can transfer to it.
    // Anchor's init constraint allocates and assigns an empty system-owned PDA.
    // Only a valid program-owned account is evidence of completed initialization.
    function initializedAccount(info, accountName) {
        if (info == null) return null;
        if (info.executable !== false || !Buffer.isBuffer(info.data) ||
            !info.owner || typeof info.owner.equals !== 'function') {
            throw new Error(`Invalid ${accountName} account metadata`);
        }
        if (info.owner.equals(SystemProgram.programId) && info.data.length === 0) return null;
        if (!info.owner.equals(programId)) {
            throw new Error(`Unexpected owner for ${accountName} account`);
        }
        if (info.data.length !== coder.size(accountName)) {
            throw new Error(`Invalid ${accountName} account size`);
        }
        try {
            return coder.decode(accountName, info.data);
        } catch (_) {
            throw new Error(`Invalid ${accountName} account data or discriminator`);
        }
    }

    function readContractAccount(info, contractHash) {
        const account = initializedAccount(info, 'Contract');
        if (!account) return null;
        if (!Buffer.from(account.contract_hash).equals(Buffer.from(contractHash))) {
            throw new Error('Contract account does not match the requested contract hash');
        }
        return account;
    }

    function readMultisigAccount(info, contractPda) {
        const account = initializedAccount(info, 'MultiSigContract');
        if (!account) return null;
        if (!account.contract.equals(contractPda)) {
            throw new Error('Multisig account does not match the requested contract');
        }
        validateMultisigConfig(account.threshold, account.max_signers);
        if (account.signatures_collected > account.max_signers) {
            throw new Error('Invalid multisig signature count');
        }
        return { ...account, maxSigners: account.max_signers };
    }

    return { readContractAccount, readMultisigAccount };
}

// Initialization is not idempotent on-chain. Another caller can initialize the
// PDA after our first read but before our transaction. Send only once, then
// recover only when a fresh read proves the exact requested state now exists.
// A null receipt means the account is usable, not that our transaction succeeded.
async function initializeOrReadExisting({ initialize, fetchAccount, readAccount }) {
    try {
        return await initialize();
    } catch (initializationError) {
        let info;
        try {
            info = await fetchAccount();
        } catch (_) {
            throw initializationError;
        }
        // Keep decoding/configuration failures visible. An absent or merely
        // prefunded account cannot establish successful initialization.
        if (!readAccount(info)) throw initializationError;
        return null;
    }
}

module.exports = { createAccountReaders, initializeOrReadExisting };
