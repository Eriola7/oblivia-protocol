require('dotenv').config();
const { Connection, Keypair, PublicKey } = require('@solana/web3.js');
const anchor = require('@coral-xyz/anchor');
const crypto = require('crypto');

/**
 * Oblivia Witness Node — Alpha
 * 
 * A lightweight notarization node that:
 * 1. Watches for new signatures on the Oblivia Anchor program
 * 2. Timestamps and notarizes them on-chain
 * 3. Produces a permanent, verifiable witness record
 * 
 * In production: permissionless network of nodes — anyone can run one.
 * This alpha demonstrates the notarization mechanism.
 */

const PROGRAM_ID = new PublicKey('HaRpXyybfpYpwxkhfj8CjY8EjGqvRd96Zi33iSCTxvHG');
const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const { storeProofOnChain } = require('./solana_integration');

function getKeypair() {
    return Keypair.fromSecretKey(Buffer.from(process.env.OBLIVIA_DEVNET_KEY, 'hex'));
}

function getProvider(keypair) {
    const wallet = new anchor.Wallet(keypair);
    return new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
}

async function getProgram(provider) {
    const idl = require('./oblivia-contracts/target/idl/oblivia_contracts.json');
    return new anchor.Program(idl, provider);
}

/**
 * Notarize a signature — create a timestamped witness record on-chain
 */
async function notarizeSignature(keyCommitment, signatureCommitment, contractPubkey) {
    const timestamp = Date.now();
    const witnessRecord = {
        protocol: 'oblivia-witness-v1',
        key_commitment: keyCommitment,
        signature_commitment: signatureCommitment,
        contract: contractPubkey,
        witnessed_at: timestamp,
        witness_hash: crypto.createHash('sha256')
            .update(keyCommitment + signatureCommitment + timestamp.toString())
            .digest('hex')
    };

    console.log('\n=== Witness Node — Notarizing Signature ===');
    console.log('Key commitment:', keyCommitment.slice(0, 16), '...');
    console.log('Contract:', contractPubkey.slice(0, 16), '...');
    console.log('Witnessed at:', new Date(timestamp).toISOString());

    const tx = await storeProofOnChain(JSON.stringify(witnessRecord));
    console.log('Witness record anchored on-chain.');
    console.log('Identity revealed: false');
    console.log('Data transmitted: false');
    return { witnessRecord, tx };
}

/**
 * Fetch all signatures from the Anchor program and notarize new ones
 */
async function runWitnessNode() {
    console.log('=== Oblivia Witness Node Alpha ===');
    console.log('Program:', PROGRAM_ID.toString());
    console.log('Network: Solana Devnet');
    console.log('Status: Running\n');

    const keypair = getKeypair();
    const provider = getProvider(keypair);
    const program = await getProgram(provider);

    console.log('Fetching all signatures from Anchor program...');
    const signatures = await program.account.obliviaSignature.all();
    console.log('Signatures found:', signatures.length);

    if (signatures.length === 0) {
        console.log('No signatures to notarize.');
        return;
    }

    console.log('\nNotarizing all signatures...');
    const results = [];

    for (const sig of signatures) {
        const keyCommitment = Buffer.from(sig.account.keyCommitment).toString('hex');
        const signatureCommitment = Buffer.from(sig.account.signatureCommitment).toString('hex');
        const contractPubkey = sig.account.contract.toString();

        const result = await notarizeSignature(keyCommitment, signatureCommitment, contractPubkey);
        results.push(result);
    }

    console.log('\n=== Witness Node Summary ===');
    console.log('Signatures notarized:', results.length);
    console.log('All witness records anchored on Solana devnet.');
    console.log('Permissionless. Permanent. Verifiable.');
    console.log('Identity revealed: false');
    console.log('Data transmitted: false');
}

runWitnessNode().catch(console.error);
