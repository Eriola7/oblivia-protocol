// Generate and locally verify a contract-bound proof. No wallet, no network.
const oblivia = require('@oblivia/sdk');

async function main() {
    // In production, load this from your key store; never generate per run.
    const signerSecret = oblivia.generateSignerSecret();

    const proof = await oblivia.generateProof(signerSecret, 'I agree to the terms of the pilot.');

    console.log('Contract hash:  ', Buffer.from(proof.contractHash).toString('hex'));
    console.log('Key commitment: ', Buffer.from(proof.keyCommitment).toString('hex'));
    console.log('Public inputs:  ', proof.publicInputs.length, 'bytes');
}

main()
    .catch(error => { console.error(error); process.exitCode = 1; })
    // snarkjs keeps a worker pool alive; release it so the process exits.
    .finally(() => globalThis.curve_bn128 && globalThis.curve_bn128.terminate());
