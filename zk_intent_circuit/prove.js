const { Noir } = require('@noir-lang/noir_js');
const { Barretenberg, UltraHonkBackend } = require('@aztec/bb.js');
const circuit = require('./target/zk_intent_circuit.json');

async function generateProof() {
    console.log("Initialising Barretenberg...");
    const api = await Barretenberg.new({ threads: 1 });
    
    const backend = new UltraHonkBackend(circuit.bytecode, api);
    const noir = new Noir(circuit);

    const input = {
        contract_hash: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32],
        signer_key: "12345678",
        timestamp: "1746000000"
    };

    console.log("Executing circuit...");
    const { witness } = await noir.execute(input);

    console.log("Generating proof...");
    const proof = await backend.generateProof(witness);
    console.log("Proof generated.");

    console.log("Verifying proof...");
    const verified = await backend.verifyProof(proof);
    console.log("Verified:", verified);
    
    await api.destroy();
}

generateProof().catch(console.error);
