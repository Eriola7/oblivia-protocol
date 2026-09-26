const { generateIntentProof } = require('../lib/groth16_intent');

async function main() {
    try {
        const proof = await generateIntentProof(12345678n, 'Oblivia SDK proof test', '1000000000');
        if (proof.publicInputs.length !== 128) throw new Error('invalid public input length');
        console.log('PASS: SDK Groth16 proof');
    } finally {
        // Only the one-shot CLI owns cleanup; do not terminate workers in SDK calls.
        if (globalThis.curve_bn128) await globalThis.curve_bn128.terminate();
    }
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
