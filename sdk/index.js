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

const { generate, reproduce } = require('./lib/fuzzyExtractor');
const { generateIntentProof } = require('./lib/groth16_intent');
const { 
    registerContract, 
    createMultisig,
    finalizeMultisig,
    initializeRegistry
} = require('./lib/anchor_integration');
const { submitVerifiedGroth16, submitVerifiedMultiSig } = require('./lib/anchor_integration');

const { createHash } = require('crypto');

function hashContract(contractData) {
    if (typeof contractData !== 'string') throw new TypeError('contractData must be a string');
    return Array.from(createHash('sha256').update(contractData, 'utf8').digest());
}

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
 * @returns {Promise<{ proofA: number[], proofB: number[], proofC: number[], publicInputs: number[], keyCommitment: number[], signatureCommitment: number[], contractHash: number[] }>}
 */
async function generateProof(biometricFeatures, contractData) {
    const { key: signingKeyHex } = generate(biometricFeatures);
    return generateIntentProof(BigInt('0x' + signingKeyHex.slice(0, 32)), contractData);
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
    const proof = await generateProof(biometricFeatures, contractData);
    const { keyCommitment, signatureCommitment, contractHash } = proof;

    await registerContract(contractHash);
    await submitVerifiedGroth16(contractHash, proof);

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
    const contractHash = hashContract(contractData);
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
    const proof = await generateProof(biometricFeatures, contractData);
    const { keyCommitment, signatureCommitment, contractHash } = proof;

    await submitVerifiedMultiSig(contractHash, proof);

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
    const contractHash = hashContract(contractData);
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
