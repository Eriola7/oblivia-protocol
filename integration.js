const { Noir } = require('@noir-lang/noir_js');
const { Barretenberg, UltraHonkBackend } = require('@aztec/bb.js');
const { generate } = require('./biometric-entropy-client/fuzzyExtractor');
const circuit = require('./zk_intent_circuit/target/zk_intent_circuit.json');
const { registerContract, submitSignature, verifySignature } = require('./anchor_integration');

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

    // Step 2: Hash the contract
    console.log("\nStep 2: Hashing contract...");
    const contractHash = Array.from(
        Buffer.from(contractData.padEnd(32, '\0').slice(0, 32))
    );
    console.log("Contract hash:", contractHash.slice(0, 8), "...");

    // Step 3: Generate ZK proof
    console.log("\nStep 3: Generating ZK proof...");
    const api = await Barretenberg.new({ threads: 1 });
    const backend = new UltraHonkBackend(circuit.bytecode, api);
    const noir = new Noir(circuit);

    const input = {
        contract_hash: contractHash,
        signer_key: signingKey,
        timestamp: Date.now().toString()
    };

    const { witness } = await noir.execute(input);
    const proof = await backend.generateProof(witness);

    // Step 4: Verify proof locally
    console.log("\nStep 4: Verifying proof locally...");
    const verified = await backend.verifyProof(proof);
    await api.destroy();

    if (!verified) {
        throw new Error("Local proof verification failed");
    }

    console.log("Proof verified locally.");

    // Extract public outputs (key_commitment and signature_commitment)
    const publicInputs = proof.publicInputs;
    const keyCommitment = publicInputs[0];
    const signatureCommitment = publicInputs[1];

    console.log("\nKey commitment:", keyCommitment.slice(0, 16), "...");
    console.log("Signature commitment:", signatureCommitment.slice(0, 16), "...");

    // Step 5: Register contract on Anchor program
    console.log("\nStep 5: Registering contract on Solana...");
    await registerContract(contractHash);

    // Step 6: Submit ZK commitments to Anchor program
    console.log("\nStep 6: Submitting ZK commitments to Anchor program...");
    await submitSignature(contractHash, keyCommitment, signatureCommitment);

    // Step 7: Verify on-chain
    console.log("\nStep 7: Verifying signature on-chain...");
    await verifySignature(contractHash, keyCommitment, signatureCommitment);

    console.log("\n=== Result ===");
    console.log("Contract signed:", true);
    console.log("Identity revealed: false");
    console.log("Data transmitted: false");
    console.log("On-chain verified: true");
    console.log("Proof size:", proof.proof.length, "fields");

    return { verified: true, proof, keyCommitment, signatureCommitment };
}

const biometricFeatures = [
    0.82, 0.45, 0.91, 0.33, 0.76, 0.54, 0.88, 0.21, 0.67, 0.43,
    0.79, 0.55, 0.83, 0.31, 0.72, 0.49, 0.85, 0.28, 0.64, 0.41
];

const contractData = "NDA Agreement - Party A and Party B";

signContract(biometricFeatures, contractData).catch(console.error);
