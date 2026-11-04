const { Connection, Keypair, PublicKey } = require('@solana/web3.js');
const anchor = require('@coral-xyz/anchor');
const { validateMultisigConfig, assertMultisigConfig, multisigSeeds } = require('./multisig_config');
const { createAccountReaders, initializeOrReadExisting } = require('./account_state');
const { readContractAccount, readMultisigAccount } = createAccountReaders(anchor);

const PROGRAM_ID = new PublicKey('HaRpXyybfpYpwxkhfj8CjY8EjGqvRd96Zi33iSCTxvHG');
const REGISTRY_SEED = Buffer.from('oblivia_registry');
const CONTRACT_SEED = Buffer.from('oblivia_contract');
const MULTISIG_MEMBER_SEED = Buffer.from("oblivia_multisig_member");
const SIGNATURE_SEED = Buffer.from('oblivia_signature');

const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

// A library must not load .env files into its host process; the application
// owns its environment (e.g. `node --env-file=.env app.js` or dotenv).
function getKeypair() {
    const secretHex = process.env.OBLIVIA_DEVNET_KEY;
    if (typeof secretHex !== 'string' || !/^[0-9a-fA-F]{128}$/.test(secretHex)) {
        throw new Error('OBLIVIA_DEVNET_KEY must be set to a 64-byte hex-encoded Solana secret key to submit transactions');
    }
    return Keypair.fromSecretKey(Buffer.from(secretHex, 'hex'));
}

function getProvider(keypair) {
    const wallet = new anchor.Wallet(keypair);
    return new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
}

async function getProgram(provider) {
    const idl = require('./idl.json');
    return new anchor.Program(idl, provider);
}

async function initializeRegistry() {
    const keypair = getKeypair();
    const provider = getProvider(keypair);
    const program = await getProgram(provider);

    const [registryPda] = PublicKey.findProgramAddressSync(
        [REGISTRY_SEED],
        PROGRAM_ID
    );

    console.log('Initializing Oblivia registry...');
    const tx = await program.methods
        .initialize()
        .accounts({
            registry: registryPda,
            authority: keypair.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([keypair])
        .rpc();

    console.log('Registry initialized. Transaction:', tx);
    console.log('Explorer: https://explorer.solana.com/tx/' + tx + '?cluster=devnet');
    return registryPda;
}

async function registerContract(contractHash) {
    const keypair = getKeypair();
    const provider = getProvider(keypair);
    const program = await getProgram(provider);

    const contractHashBytes = Buffer.from(contractHash).slice(0, 32);

    const [registryPda] = PublicKey.findProgramAddressSync(
        [REGISTRY_SEED],
        PROGRAM_ID
    );

    const [contractPda] = PublicKey.findProgramAddressSync(
        [CONTRACT_SEED, contractHashBytes],
        PROGRAM_ID
    );

    // Lamports alone do not mean the PDA has been initialized.
    const existing = await connection.getAccountInfo(contractPda);
    if (readContractAccount(existing, contractHashBytes)) {
        console.log('Contract already registered on-chain:', contractPda.toString());
        return { contractPda, tx: null };
    }

    console.log('Registering contract on-chain...');
    const tx = await initializeOrReadExisting({
        initialize: () => program.methods
            .registerContract(Array.from(contractHashBytes))
            .accounts({
                registry: registryPda,
                contract: contractPda,
                payer: keypair.publicKey,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([keypair])
            .rpc(),
        fetchAccount: () => connection.getAccountInfo(contractPda),
        readAccount: info => readContractAccount(info, contractHashBytes),
    });
    if (tx === null) {
        console.log('Contract now registered on-chain:', contractPda.toString());
        return { contractPda, tx: null };
    }

    console.log('Contract registered. Transaction:', tx);
    console.log('Explorer: https://explorer.solana.com/tx/' + tx + '?cluster=devnet');
    return { contractPda, tx };
}

module.exports = { initializeRegistry, registerContract, createMultisig, finalizeMultisig };

async function createMultisig(contractHash, threshold, maxSigners) {
    validateMultisigConfig(threshold, maxSigners);
    const keypair = getKeypair();
    const provider = getProvider(keypair);
    const program = await getProgram(provider);

    const contractHashBytes = Buffer.from(contractHash).slice(0, 32);

    const [contractPda] = PublicKey.findProgramAddressSync(
        [CONTRACT_SEED, contractHashBytes], PROGRAM_ID
    );
    const [multisigPda] = PublicKey.findProgramAddressSync(
        multisigSeeds(contractHashBytes, threshold, maxSigners), PROGRAM_ID
    );

    const existing = readMultisigAccount(await connection.getAccountInfo(multisigPda), contractPda);
    if (existing) {
        assertMultisigConfig(existing, threshold, maxSigners);
        console.log('MultiSig already exists:', multisigPda.toString());
        return { multisigPda, tx: null };
    }

    const tx = await initializeOrReadExisting({
        initialize: () => program.methods
            .createMultisig(Array.from(contractHashBytes), threshold, maxSigners)
            .accounts({ contract: contractPda, multisig: multisigPda, payer: keypair.publicKey, systemProgram: anchor.web3.SystemProgram.programId })
            .signers([keypair])
            .rpc(),
        fetchAccount: () => connection.getAccountInfo(multisigPda),
        readAccount: info => {
            const account = readMultisigAccount(info, contractPda);
            if (account) assertMultisigConfig(account, threshold, maxSigners);
            return account;
        },
    });
    if (tx === null) {
        console.log('MultiSig now exists on-chain:', multisigPda.toString());
        return { multisigPda, tx: null };
    }

    console.log('MultiSig created. Transaction:', tx);
    console.log('Explorer: https://explorer.solana.com/tx/' + tx + '?cluster=devnet');
    return { multisigPda, tx };
}

async function finalizeMultisig(contractHash, threshold, maxSigners) {
    const keypair = getKeypair();
    const provider = getProvider(keypair);
    const program = await getProgram(provider);

    const contractHashBytes = Buffer.from(contractHash).slice(0, 32);

    const [multisigPda] = PublicKey.findProgramAddressSync(
        multisigSeeds(contractHashBytes, threshold, maxSigners), PROGRAM_ID
    );

    const [contractPda] = PublicKey.findProgramAddressSync(
        [CONTRACT_SEED, contractHashBytes], PROGRAM_ID
    );
    // The threshold signature normally finalized this agreement already.
    const existing = await program.account.multiSigContract.fetch(multisigPda);
    if (existing.finalized) return null;

    const tx = await program.methods
        .finalizeMultisig(Array.from(contractHashBytes))
        .accounts({ contract: contractPda, multisig: multisigPda })
        .rpc();

    console.log('MultiSig finalized. Transaction:', tx);
    console.log('Explorer: https://explorer.solana.com/tx/' + tx + '?cluster=devnet');
    return tx;
}

async function submitVerifiedGroth16(contractHash, proof) {
    const keypair = getKeypair(), provider = getProvider(keypair), program = await getProgram(provider);
    const hash = Buffer.from(contractHash), key = Buffer.from(proof.keyCommitment), sig = Buffer.from(proof.signatureCommitment);
    const [registry] = PublicKey.findProgramAddressSync([REGISTRY_SEED], PROGRAM_ID);
    const [contract] = PublicKey.findProgramAddressSync([CONTRACT_SEED, hash], PROGRAM_ID);
    const [signature] = PublicKey.findProgramAddressSync([SIGNATURE_SEED, contract.toBuffer(), key, sig], PROGRAM_ID);
    const [signerRecord] = PublicKey.findProgramAddressSync([Buffer.from('oblivia_signer_record'), hash, key], PROGRAM_ID);
    return program.methods.verifyGroth16V2(proof.proofA, proof.proofB, proof.proofC, proof.publicInputs, Array.from(key), Array.from(sig))
        .accounts({ registry, contract, signature, signerRecord, payer: keypair.publicKey, systemProgram: anchor.web3.SystemProgram.programId }).signers([keypair]).rpc();
}

async function submitVerifiedMultiSig(contractHash, threshold, maxSigners, proof) {
    const keypair = getKeypair(), provider = getProvider(keypair), program = await getProgram(provider);
    const hash = Buffer.from(contractHash), key = Buffer.from(proof.keyCommitment), sig = Buffer.from(proof.signatureCommitment);
    const [registry] = PublicKey.findProgramAddressSync([REGISTRY_SEED], PROGRAM_ID);
    const [contract] = PublicKey.findProgramAddressSync([CONTRACT_SEED, hash], PROGRAM_ID);
    const [signature] = PublicKey.findProgramAddressSync([SIGNATURE_SEED, contract.toBuffer(), key, sig], PROGRAM_ID);
    const [signerRecord] = PublicKey.findProgramAddressSync([Buffer.from('oblivia_signer_record'), hash, key], PROGRAM_ID);
    const [multisig] = PublicKey.findProgramAddressSync(multisigSeeds(hash, threshold, maxSigners), PROGRAM_ID);
    const [member] = PublicKey.findProgramAddressSync([MULTISIG_MEMBER_SEED, multisig.toBuffer(), key], PROGRAM_ID);
    const verify = await program.methods.verifyGroth16V2(proof.proofA, proof.proofB, proof.proofC, proof.publicInputs, Array.from(key), Array.from(sig))
        .accounts({ registry, contract, signature, signerRecord, payer: keypair.publicKey, systemProgram: anchor.web3.SystemProgram.programId }).instruction();
    const record = await program.methods.recordVerifiedMultisig(Array.from(hash), Array.from(key))
        .accounts({ registry, contract, multisig, signerRecord, signature, multisigMember: member, payer: keypair.publicKey, systemProgram: anchor.web3.SystemProgram.programId }).instruction();
    return provider.sendAndConfirm(new anchor.web3.Transaction().add(verify, record), [keypair]);
}

module.exports.submitVerifiedGroth16 = submitVerifiedGroth16;
module.exports.submitVerifiedMultiSig = submitVerifiedMultiSig;
