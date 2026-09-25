/**
 * Oblivia SDK browser entry point.
 *
 * Proving is entirely local, using the same Groth16 circuit and verification
 * key accepted by the v2 Solana program. Callers supply URLs for the WASM and
 * proving key so their bundler or asset host controls delivery.
 */
const snarkjs = require('snarkjs');
const { generate } = require('./lib/fuzzyExtractor');
const verificationKey = require('./lib/proving/verification_key.json');

function deriveKey(biometricFeatures) {
    return generate(biometricFeatures).key;
}

function toField(bytes) {
    return BigInt('0x' + Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')).toString();
}

async function hashContract(contractData) {
    if (!globalThis.crypto || !globalThis.crypto.subtle) {
        throw new Error('WebCrypto is required for browser-side contract hashing');
    }
    const data = typeof contractData === 'string'
        ? new TextEncoder().encode(contractData)
        : contractData;
    return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', data));
}

/**
 * Generate and locally verify a contract-bound Groth16 proof.
 *
 * @param {number[]} biometricFeatures normalized local facial measurements
 * @param {string|Uint8Array} contractData canonical contract bytes
 * @param {{wasmUrl: string, zkeyUrl: string}} provingAssets publicly served circuit artifacts
 */
async function generateProof(biometricFeatures, contractData, provingAssets) {
    if (!provingAssets || !provingAssets.wasmUrl || !provingAssets.zkeyUrl) {
        throw new Error('provingAssets.wasmUrl and provingAssets.zkeyUrl are required');
    }

    const signingKey = deriveKey(biometricFeatures);
    const contractHash = await hashContract(contractData);
    const input = {
        // Match the Node SDK and reference clients' 128-bit signing scalar.
        signer_key: BigInt('0x' + signingKey.slice(0, 32)).toString(),
        contract_hash_lo: toField(contractHash.slice(0, 16)),
        contract_hash_hi: toField(contractHash.slice(16, 32)),
        timestamp: Date.now().toString()
    };
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        input,
        provingAssets.wasmUrl,
        provingAssets.zkeyUrl
    );
    const verified = await snarkjs.groth16.verify(verificationKey, publicSignals, proof);
    if (!verified) throw new Error('local Groth16 proof verification failed');

    return { contractHash: Array.from(contractHash), proof, publicInputs: publicSignals, verified };
}

module.exports = { deriveKey, generateProof };
