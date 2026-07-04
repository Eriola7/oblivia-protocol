/**
 * Oblivia SDK — Browser entry point.
 *
 * On-device operations only: biometric key derivation and ZK proof
 * generation via Barretenberg WASM. No Node dependencies, no keypairs,
 * nothing leaves the browser.
 *
 * On-chain submission from the browser is done through the developer's
 * own wallet adapter — see reference dApps for the full pattern.
 *
 * Usage (with a bundler):
 *   import { deriveKey, generateProof } from '@oblivia/sdk/browser';
 */

const { Noir } = require('@noir-lang/noir_js');
const { Barretenberg, UltraHonkBackend } = require('@aztec/bb.js');
const { generate } = require('./lib/fuzzyExtractor');
const circuit = require('./lib/circuit.json');

/**
 * Derive a signing key from biometric features. Entirely on-device.
 * @param {number[]} biometricFeatures - 20 normalized facial geometry ratios
 * @returns {string} hex-encoded signing key
 */
function deriveKey(biometricFeatures) {
    const { key } = generate(biometricFeatures);
    return key;
}

/**
 * Generate a ZK proof of contract signing in the browser.
 * Real Barretenberg WASM proving — no simulation, no server round-trip.
 * @param {number[]} biometricFeatures
 * @param {string|Uint8Array} contractData
 * @returns {Promise<{proof: Uint8Array, publicInputs: string[], verified: boolean}>}
 */
async function generateProof(biometricFeatures, contractData) {
    const signingKey = deriveKey(biometricFeatures);

    const contractBytes = typeof contractData === 'string'
        ? new TextEncoder().encode(contractData)
        : contractData;

    // SHA-256 via WebCrypto (browser-native)
    const hashBuffer = await crypto.subtle.digest('SHA-256', contractBytes);
    const contractHash = Array.from(new Uint8Array(hashBuffer)).slice(0, 32);

    const api = await Barretenberg.new({ threads: 1 });
    const backend = new UltraHonkBackend(circuit.bytecode, api);
    const noir = new Noir(circuit);

    const { witness } = await noir.execute({
        contract_hash: contractHash,
        signer_key: BigInt('0x' + signingKey.slice(0, 32)).toString(),
        timestamp: Date.now().toString()
    });

    const proofData = await backend.generateProof(witness);
    const verified = await backend.verifyProof(proofData);
    await api.destroy();

    return {
        proof: proofData.proof,
        publicInputs: proofData.publicInputs,
        verified
    };
}

module.exports = { deriveKey, generateProof };
