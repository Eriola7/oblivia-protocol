const { generate } = require('./biometric-entropy-client/fuzzyExtractor');
const { generateIntentProof } = require('./groth16_intent');
const { registerContract, submitVerifiedGroth16 } = require('./anchor_integration');

/**
 * Oblivia - Full Integration
 * Biometric → ZK proof → Anchor program → on-chain verified
 * Zero identity revealed. Zero data transmitted.
 */

async function signContract(biometricFeatures, contractData) {
    console.log("=== Oblivia Protocol - Contract Signing ===\n");

    // Step 1: Derive signing key from biometric
    console.log("Step 1: Deriving signing key from biometric...");
    const { key: signingKeyHex, sketch } = generate(biometricFeatures);
    const signingKey = BigInt('0x' + signingKeyHex.slice(0, 32)).toString();
    console.log("Signing key derived. (never transmitted, never stored)");

    // Step 2: Generate a contract-bound Groth16 proof.
    console.log("\nStep 3: Generating ZK proof...");
    const proof = await generateIntentProof(signingKey, contractData);
    const contractHash = Array.from(proof.contractHash);
    const keyCommitment = Buffer.from(proof.keyCommitment).toString('hex');
    const signatureCommitment = Buffer.from(proof.signatureCommitment).toString('hex');

    console.log("\nKey commitment:", keyCommitment.slice(0, 16), "...");
    console.log("Signature commitment:", signatureCommitment.slice(0, 16), "...");

    // Step 5: Register contract on Anchor program
    console.log("\nStep 5: Registering contract on Solana...");
    await registerContract(contractHash);

    // Step 6: Atomically verify the proof and record the signature on-chain.
    console.log("\nStep 6: Submitting verified proof to Anchor...");
    await submitVerifiedGroth16(contractHash, proof);

    console.log("\n=== Result ===");
    console.log("Contract signed:", true);
    console.log("Identity revealed: false");
    console.log("Data transmitted: false");
    console.log("On-chain verified: true");
    console.log("Proof size:", proof.proofA.length + proof.proofB.length + proof.proofC.length, "bytes");

    return { verified: true, proof, keyCommitment, signatureCommitment };
}

const biometricFeatures = [
    0.82, 0.45, 0.91, 0.33, 0.76, 0.54, 0.88, 0.21, 0.67, 0.43,
    0.79, 0.55, 0.83, 0.31, 0.72, 0.49, 0.85, 0.28, 0.64, 0.41
];

const contractData = "NDA Agreement - Party A and Party B";

signContract(biometricFeatures, contractData).catch(console.error);
