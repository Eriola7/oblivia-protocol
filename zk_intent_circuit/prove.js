const { Noir } = require('@noir-lang/noir_js');
const { BarretenbergBackend } = require('@noir-lang/backend_barretenberg');
const circuit = require('./target/zk_intent_circuit.json');

async function generateProof() {
    const backend = new BarretenbergBackend(circuit);
    const noir = new Noir(circuit, backend);

    const input = {
        contract_hash: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32],
        signer_key: "12345678",
        timestamp: "1746000000"
    };

    console.log("Generating ZK proof...");
    const { witness } = await noir.execute(input);
    const proof = await backend.generateProof(witness);
    console.log("Proof generated successfully.");
    console.log("Proof:", Buffer.from(proof.proof).toString('hex').slice(0, 64) + "...");
    
    console.log("Verifying proof...");
    const verified = await backend.verifyProof(proof);
    console.log("Proof verified:", verified);
}

generateProof().catch(console.error);
