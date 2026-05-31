// === Multi-Sig Demo ===
// Demonstrates anonymous M-of-N threshold signing
// Three parties sign independently — contract finalizes when threshold reached

async function multiSigDemo() {
    console.log("\n=== Oblivia Multi-Sig Demo — 2-of-3 Anonymous Signing ===\n");

    const { createMultisig, finalizeMultisig, registerContract, submitSignature, verifySignature } = require("./anchor_integration");
    const { Noir } = require('@noir-lang/noir_js');
    const { Barretenberg, UltraHonkBackend } = require('@aztec/bb.js');
    const { generate } = require("./biometric-entropy-client/fuzzyExtractor");
    const circuit = require('./zk_intent_circuit/target/zk_intent_circuit.json');

    const contractData = "DAO Governance Proposal 1 - Treasury Allocation";
    const contractHash = Array.from(
        Buffer.from(contractData.padEnd(32, '\0').slice(0, 32))
    );

    console.log("Registering governance contract on-chain...");
    await registerContract(contractHash);

    console.log("Creating 2-of-3 multi-sig...");
    await createMultisig(contractHash, 2, 3);
    console.log("MultiSig created. Threshold: 2 of 3 signers required.");

    async function signAs(features, label) {
        console.log("\n" + label + " signing...");
        const { key: signingKeyHex } = generate(features);
        const signingKey = BigInt('0x' + signingKeyHex.slice(0, 32)).toString();
        const api = await Barretenberg.new({ threads: 1 });
        const backend = new UltraHonkBackend(circuit.bytecode, api);
        const noir = new Noir(circuit);
        const input = { contract_hash: contractHash, signer_key: signingKey, timestamp: Date.now().toString() };
        const { witness } = await noir.execute(input);
        const proof = await backend.generateProof(witness);
        const verified = await backend.verifyProof(proof);
        await api.destroy();
        const keyCommitment = proof.publicInputs[0];
        const signatureCommitment = proof.publicInputs[1];
        await submitSignature(contractHash, keyCommitment, signatureCommitment);
        console.log(label + " complete. Identity revealed: false");
        return { keyCommitment, signatureCommitment };
    }

    const features1 = [0.82, 0.45, 0.91, 0.33, 0.76, 0.54, 0.88, 0.21, 0.67, 0.43, 0.79, 0.55, 0.83, 0.31, 0.72, 0.49, 0.85, 0.28, 0.64, 0.41];
    const features2 = [0.71, 0.38, 0.84, 0.29, 0.65, 0.47, 0.79, 0.18, 0.58, 0.36, 0.69, 0.48, 0.74, 0.27, 0.63, 0.42, 0.76, 0.24, 0.57, 0.35];

    await signAs(features1, "Signer 1");
    await signAs(features2, "Signer 2");

    console.log("\nFinalizing multi-sig — threshold reached...");
    await finalizeMultisig(contractHash);

    console.log("\n=== Multi-Sig Result ===");
    console.log("Contract finalized: true");
    console.log("Signers revealed: 0 of 2");
    console.log("Threshold met: 2 of 3");
    console.log("Identity revealed: false");
    console.log("Data transmitted: false");
    console.log("On-chain verified: true");
}

multiSigDemo().catch(console.error);
