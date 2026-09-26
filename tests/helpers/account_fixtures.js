const { BorshAccountsCoder, BN } = require('@coral-xyz/anchor');
const { PublicKey, SystemProgram } = require('@solana/web3.js');
const idl = require('../../sdk/lib/idl.json');

const programId = new PublicKey(idl.address);
const coder = new BorshAccountsCoder(idl);
const contractHash = Buffer.alloc(32, 1);
const [contractPda, contractBump] = PublicKey.findProgramAddressSync([
    Buffer.from('oblivia_contract'), contractHash,
], programId);
const [, multisigBump] = PublicKey.findProgramAddressSync([
    Buffer.from('oblivia_multisig'), contractHash,
], programId);

function prefundedAccount() {
    return { owner: SystemProgram.programId, lamports: 1000000, data: Buffer.alloc(0), executable: false };
}

async function contractAccount(overrides = {}) {
    const data = await coder.encode('Contract', {
        contract_hash: Array.from(contractHash), timestamp: new BN(1), signature_count: new BN(0),
        active: true, bump: contractBump, ...overrides,
    });
    return { owner: programId, lamports: 1000000, data, executable: false };
}

async function multisigAccount(overrides = {}) {
    const data = await coder.encode('MultiSigContract', {
        contract: contractPda, threshold: 2, signatures_collected: 0, max_signers: 3,
        finalized: false, finalized_at: new BN(0), bump: multisigBump, ...overrides,
    });
    return { owner: programId, lamports: 1000000, data, executable: false };
}

module.exports = { programId, contractHash, contractPda, prefundedAccount, contractAccount, multisigAccount };
