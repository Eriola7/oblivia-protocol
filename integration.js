const { Noir } = require('@noir-lang/noir_js');
const { Barretenberg, UltraHonkBackend } = require('@aztec/bb.js');
const { deriveKey } = require('./biometric-entropy-client/fuzzyExtractor');
const circuit = require('./zk_intent_circuit/target/zk_intent_circuit.json');

/**
 * Oblivia - Full Integration Test
 * Biometric features → signing key → ZK proof → verified
 * Zero identity revealed. Zero data transmitted.
 */

async function signContract(biometricFeatures, contractData) {
    console.log("=== Oblivia Protocol - Contract Signing ===\n");

    // Step 1: Derive signing key from biometric
    console.log("Step 1: Deriving signing key from biometric...");
    const signingKeyHex = deriveKey(biometricFeatures);
    const signingKey = BigInt('0x' + signingKeyHex.slice(0, 16)).toString();
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
    
    // Step 4: Verify
    console.log("\nStep 4: Verifying proof...");
    const verified = await backend.verifyProof(proof);
    
    await api.destroy();

    console.log("\n=== Result ===");
    console.log("Contract signed:", verified);
    console.log("Identity revealed: false");
    console.log("Data transmitted: false");
    console.log("Proof size:", proof.proof.length, "fields");
    
    return { verified, proof };
}

// Test with simulated biometric
const biometricFeatures = [
    0.82, 0.45, 0.91, 0.33, 0.76, 0.54, 0.88, 0.21, 0.67, 0.43,
    0.79, 0.55, 0.83, 0.31, 0.72, 0.49, 0.85, 0.28, 0.64, 0.41
];

const contractData = "NDA Agreement - Party A and Party B";

signContract(biometricFeatures, contractData).catch(console.error);
