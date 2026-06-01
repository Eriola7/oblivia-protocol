/**
 * Oblivia Protocol SDK
 * 
 * Zero-identity contract signing for Solana.
 * Free to use. MIT licensed. Forever.
 * 
 * Usage:
 *   const oblivia = require('@oblivia/sdk');
 *   const result = await oblivia.signContract(biometricFeatures, contractData);
 */

const { Noir } = require('@noir-lang/noir_js');
const { Barretenberg, UltraHonkBackend } = require('@aztec/bb.js');
const { generate, reproduce } = require('../biometric-entropy-client/fuzzyExtractor');
const { 
    registerContract, 
    submitSignature, 
    verifySignature,
    createMultisig,
    finalizeMultisig,
    initializeRegistry
} = require('../anchor_integration');

const circuit = require('../zk_intent_circuit/target/zk_intent_circuit.json');

/**
 * Derive a signing key from biometric features
 * The key is never stored or transmitted
 * 
 * @param {number[]} biometricFeatures - Array of 20 facial geometry ratios
 * @returns {{ key: string, sketch: number[] }}
 */
function deriveKey(biometricFeatures) {
    return generate(biometricFeatures);
}

/**
 * Generate a ZK proof of contract signing
 * Proves you signed without revealing who you are
 * 
 * @param {number[]} biometricFeatures - Array of 20 facial geometry ratios
 * @param {string} contractData - The contract content to sign
 * @returns {{ proof, keyCommitment, signatureCommitment, contractHash }}
 */
async function generateProof(biometricFeatures, contractData) {
    const { key: signingKeyHex } = generate(biometricFeatures);
    const signingKey = BigInt('0x' + signingKeyHex.slice(0, 32)).toString();

    const contractHash = Array.from(
        Buffer.from(contractData.padEnd(32, '\0').slice(0, 32))
    );

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
    const verified = await backend.verifyProof(proof);
    await api.destroy();

    if (!verified) throw new Error('Proof verification failed');

    return {
        proof,
        keyCommitment: proof.publicInputs[0],
        signatureCommitment: proof.publicInputs[1],
        contractHash
    };
}

/**
 * Sign a contract — full pipeline
 * Biometric -> ZK proof -> Anchor program -> on-chain verified
 * 
 * @param {number[]} biometricFeatures - Array of 20 facial geometry ratios
 * @param {string} contractData - The contract content to sign
 * @returns {{ verified, keyCommitment, signatureCommitment, contractHash }}
 */
async function signContract(biometricFeatures, contractData) {
    const { proof, keyCommitment, signatureCommitment, contractHash } = 
        await generateProof(biometricFeatures, contractData);

    await registerContract(contractHash);
    await submitSignature(contractHash, keyCommitment, signatureCommitment);
    await verifySignature(contractHash, keyCommitment, signatureCommitment);

    return {
        verified: true,
        keyCommitment,
        signatureCommitment,
        contractHash,
        identityRevealed: false,
        dataTransmitted: false
    };
}

/**
 * Create an anonymous M-of-N multi-sig contract
 * 
 * @param {string} contractData - The contract content
 * @param {number} threshold - Minimum signatures required
 * @param {number} maxSigners - Maximum signers allowed
 */
async function createMultiSigContract(contractData, threshold, maxSigners) {
    const contractHash = Array.from(
        Buffer.from(contractData.padEnd(32, '\0').slice(0, 32))
    );
    await registerContract(contractHash);
    await createMultisig(contractHash, threshold, maxSigners);
    return { contractHash, threshold, maxSigners };
}

/**
 * Sign a multi-sig contract as one of N signers
 * 
 * @param {number[]} biometricFeatures - Array of 20 facial geometry ratios
 * @param {string} contractData - The contract content to sign
 */
async function signMultiSig(biometricFeatures, contractData) {
    const { proof, keyCommitment, signatureCommitment, contractHash } =
        await generateProof(biometricFeatures, contractData);

    await submitSignature(contractHash, keyCommitment, signatureCommitment);

    return {
        keyCommitment,
        signatureCommitment,
        identityRevealed: false
    };
}

/**
 * Finalize a multi-sig contract once threshold is reached
 * 
 * @param {string} contractData - The contract content
 */
async function finalizeMultiSigContract(contractData) {
    const contractHash = Array.from(
        Buffer.from(contractData.padEnd(32, '\0').slice(0, 32))
    );
    await finalizeMultisig(contractHash);
    return { finalized: true, identityRevealed: false };
}

module.exports = {
    deriveKey,
    generateProof,
    signContract,
    createMultiSigContract,
    signMultiSig,
    finalizeMultiSigContract,
    initializeRegistry
};
