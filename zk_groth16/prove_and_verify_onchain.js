const snarkjs = require('snarkjs');
const anchor = require('@coral-xyz/anchor');
const { Connection, Keypair, PublicKey } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '../.env' });

const PROGRAM_ID = new PublicKey('HaRpXyybfpYpwxkhfj8CjY8EjGqvRd96Zi33iSCTxvHG');
const REGISTRY_SEED = Buffer.from('oblivia_registry');

// BN254 field modulus for G1 negation
const Q = BigInt('21888242871839275222246405745257275088696311157297823662689037894645226208583');

function negateG1Y(yBytes) {
    const y = BigInt('0x' + Buffer.from(yBytes).toString('hex'));
    const yNeg = Q - y;
    const result = Buffer.alloc(32);
    let val = yNeg;
    for (let i = 31; i >= 0; i--) {
        result[i] = Number(val & 0xFFn);
        val >>= 8n;
    }
    return result;
}

function hexToBytes32(hexStr) {
    const clean = hexStr.startsWith('0x') ? hexStr.slice(2) : hexStr;
    return Buffer.from(clean.padStart(64, '0'), 'hex');
}

async function main() {
    console.log('=== Oblivia Groth16 On-Chain Verification ===\n');

    // Step 1: Generate Groth16 proof
    console.log('Generating Groth16 proof...');
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        { signer_key: '12345678', contract_hash: '987654321', timestamp: '1000000000' },
        path.join(__dirname, 'oblivia_js/oblivia.wasm'),
        path.join(__dirname, 'oblivia_1.zkey')
    );
    console.log('Proof generated.');
    console.log('Public signals:', publicSignals);

    // Step 2: Convert proof to Solana format
    // proof_a: negate Y coordinate
    const proof_a_x = hexToBytes32(BigInt(proof.pi_a[0]).toString(16));
    const proof_a_y = hexToBytes32(BigInt(proof.pi_a[1]).toString(16));
    const proof_a_y_neg = negateG1Y(proof_a_y);
    const proof_a_neg = Buffer.concat([proof_a_x, proof_a_y_neg]);

    // proof_b: G2 point (x_im, x_re, y_im, y_re)
    const proof_b = Buffer.concat([
        hexToBytes32(BigInt(proof.pi_b[0][1]).toString(16)),
        hexToBytes32(BigInt(proof.pi_b[0][0]).toString(16)),
        hexToBytes32(BigInt(proof.pi_b[1][1]).toString(16)),
        hexToBytes32(BigInt(proof.pi_b[1][0]).toString(16)),
    ]);

    // proof_c: G1 point
    const proof_c = Buffer.concat([
        hexToBytes32(BigInt(proof.pi_c[0]).toString(16)),
        hexToBytes32(BigInt(proof.pi_c[1]).toString(16)),
    ]);

    // public inputs: key_commitment and sig_commitment
    const pub_inputs = Buffer.concat([
        hexToBytes32(BigInt(publicSignals[0]).toString(16)),
        hexToBytes32(BigInt(publicSignals[1]).toString(16)),
    ]);

    console.log('\nKey commitment:', publicSignals[0]);
    console.log('Sig commitment:', publicSignals[1]);

    // Step 3: Connect to devnet and call program
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    const secretHex = process.env.OBLIVIA_DEVNET_KEY;
    const keypair = Keypair.fromSecretKey(Buffer.from(secretHex, 'hex'));

    const idl = JSON.parse(fs.readFileSync(
        path.join(__dirname, '../oblivia-contracts/target/idl/oblivia_contracts.json'), 'utf8'
    ));

    const provider = new anchor.AnchorProvider(
        connection,
        new anchor.Wallet(keypair),
        { commitment: 'confirmed' }
    );
    const program = new anchor.Program(idl, provider);

    const [registryPda] = PublicKey.findProgramAddressSync([REGISTRY_SEED], PROGRAM_ID);

    console.log('\nSubmitting Groth16 proof to Solana devnet...');
    const tx = await program.methods
        .verifyGroth16(
            Array.from(proof_a_neg),
            Array.from(proof_b),
            Array.from(proof_c),
            Array.from(pub_inputs)
        )
        .accounts({
            registry: registryPda,
            payer: keypair.publicKey,
        })
        .rpc();

    console.log('\n=== GROTH16 PROOF VERIFIED ON-CHAIN ===');
    console.log('Transaction:', tx);
    console.log('Explorer:   ', `https://explorer.solana.com/tx/${tx}?cluster=devnet`);
    console.log('Identity revealed: false');
    console.log('Proof verified on Solana: true');
}

main().catch(console.error);
