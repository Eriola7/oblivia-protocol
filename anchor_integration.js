require('dotenv').config();
const { Connection, Keypair, PublicKey } = require('@solana/web3.js');
const anchor = require('@coral-xyz/anchor');

const PROGRAM_ID = new PublicKey('HaRpXyybfpYpwxkhfj8CjY8EjGqvRd96Zi33iSCTxvHG');
const REGISTRY_SEED = Buffer.from('oblivia_registry');
const CONTRACT_SEED = Buffer.from('oblivia_contract');
const SIGNATURE_SEED = Buffer.from('oblivia_signature');

const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

function getKeypair() {
    const secretHex = process.env.OBLIVIA_DEVNET_KEY;
    return Keypair.fromSecretKey(Buffer.from(secretHex, 'hex'));
}

function getProvider(keypair) {
    const wallet = new anchor.Wallet(keypair);
    return new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
}

async function getProgram(provider) {
    const idl = require('./oblivia-contracts/target/idl/oblivia_contracts.json');
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

    const contractHashBytes = Buffer.from(contractHash);

    const [registryPda] = PublicKey.findProgramAddressSync(
        [REGISTRY_SEED],
        PROGRAM_ID
    );

    const [contractPda] = PublicKey.findProgramAddressSync(
        [CONTRACT_SEED, contractHashBytes],
        PROGRAM_ID
    );

    // Check if contract already registered
    const existing = await connection.getAccountInfo(contractPda);
    if (existing) {
        console.log('Contract already registered on-chain:', contractPda.toString());
        return { contractPda, tx: null };
    }

    console.log('Registering contract on-chain...');
    const tx = await program.methods
        .registerContract(Array.from(contractHashBytes))
        .accounts({
            registry: registryPda,
            contract: contractPda,
            payer: keypair.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([keypair])
        .rpc();

    console.log('Contract registered. Transaction:', tx);
    console.log('Explorer: https://explorer.solana.com/tx/' + tx + '?cluster=devnet');
    return { contractPda, tx };
}

async function submitSignature(contractHash, keyCommitment, signatureCommitment) {
    const keypair = getKeypair();
    const provider = getProvider(keypair);
    const program = await getProgram(provider);

    const contractHashBytes = Buffer.from(contractHash);
    const keyCommitmentBytes = Buffer.from(keyCommitment.replace('0x', '').padEnd(64, '0'), 'hex').slice(0, 32);
    const sigCommitmentBytes = Buffer.from(signatureCommitment.replace('0x', '').padEnd(64, '0'), 'hex').slice(0, 32);

    const [registryPda] = PublicKey.findProgramAddressSync(
        [REGISTRY_SEED],
        PROGRAM_ID
    );

    const [contractPda] = PublicKey.findProgramAddressSync(
        [CONTRACT_SEED, contractHashBytes],
        PROGRAM_ID
    );

    const [signaturePda] = PublicKey.findProgramAddressSync(
        [SIGNATURE_SEED, keyCommitmentBytes, sigCommitmentBytes],
        PROGRAM_ID
    );

    // Check if signature already submitted
    const existing = await connection.getAccountInfo(signaturePda);
    if (existing) {
        console.log('Signature already submitted on-chain:', signaturePda.toString());
        return { signaturePda, tx: null };
    }

    console.log('Submitting ZK commitments to Anchor program...');
    const tx = await program.methods
        .submitSignature(
            Array.from(keyCommitmentBytes),
            Array.from(sigCommitmentBytes)
        )
        .accounts({
            registry: registryPda,
            contract: contractPda,
            signature: signaturePda,
            payer: keypair.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([keypair])
        .rpc();

    console.log('Signature submitted. Transaction:', tx);
    console.log('Explorer: https://explorer.solana.com/tx/' + tx + '?cluster=devnet');
    return { signaturePda, tx };
}

async function verifySignature(contractHash, keyCommitment, signatureCommitment) {
    const keypair = getKeypair();
    const provider = getProvider(keypair);
    const program = await getProgram(provider);

    const contractHashBytes = Buffer.from(contractHash);
    const keyCommitmentBytes = Buffer.from(keyCommitment.replace('0x', '').padEnd(64, '0'), 'hex').slice(0, 32);
    const sigCommitmentBytes = Buffer.from(signatureCommitment.replace('0x', '').padEnd(64, '0'), 'hex').slice(0, 32);

    const [contractPda] = PublicKey.findProgramAddressSync(
        [CONTRACT_SEED, contractHashBytes],
        PROGRAM_ID
    );

    const [signaturePda] = PublicKey.findProgramAddressSync(
        [SIGNATURE_SEED, keyCommitmentBytes, sigCommitmentBytes],
        PROGRAM_ID
    );

    console.log('Verifying signature on-chain...');
    const tx = await program.methods
        .verifySignature()
        .accounts({
            contract: contractPda,
            signature: signaturePda,
        })
        .rpc();

    console.log('Signature verified on-chain. Transaction:', tx);
    console.log('Explorer: https://explorer.solana.com/tx/' + tx + '?cluster=devnet');
    return tx;
}

module.exports = { initializeRegistry, registerContract, submitSignature, verifySignature };
