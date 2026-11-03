/**
 * Oblivia Protocol SDK
 *
 * Zero-identity contract signing for Solana: an on-chain Groth16 verification
 * and contract-binding primitive. Key management and backup are left to
 * standard wallets and passkeys.
 *
 * Usage:
 *   const oblivia = require('@oblivia/sdk');
 *   const signerSecret = loadFromYourKeyStore(); // >= 32 bytes
 *   const result = await oblivia.signContract(signerSecret, contractData);
 */

const { randomBytes } = require('crypto');
const { deriveSignerKey } = require('./lib/signer_key');
const { generateIntentProof } = require('./lib/groth16_intent');
const { validateMultisigConfig } = require('./lib/multisig_config');
const { 
    registerContract, 
    createMultisig,
    finalizeMultisig,
    initializeRegistry
} = require('./lib/anchor_integration');
const { submitVerifiedGroth16, submitVerifiedMultiSig } = require('./lib/anchor_integration');

const { createHash } = require('crypto');

function validateContractData(contractData) {
    if (typeof contractData !== 'string' && !(contractData instanceof Uint8Array)) {
        throw new TypeError('contractData must be a string or Uint8Array');
    }
}

function hashContract(contractData) {
    validateContractData(contractData);
    return Array.from(createHash('sha256').update(contractData, 'utf8').digest());
}

/**
 * Generate a new 32-byte signer secret.
 * Store it in your own key store (OS keychain, KMS, wallet). Oblivia keeps no copy,
 * so losing it means losing this signer; past signatures stay valid on-chain.
 *
 * @returns {Uint8Array}
 */
function generateSignerSecret() {
    return new Uint8Array(randomBytes(32));
}

/**
 * Generate a ZK proof of contract signing
 * Proves you signed without revealing who you are
 *
 * @param {Uint8Array} signerSecret - at least 32 bytes from a passkey, wallet or device seed
 * @param {string|Uint8Array} contractData - The contract content to sign
 * @returns {Promise<{ proofA: number[], proofB: number[], proofC: number[], publicInputs: number[], keyCommitment: number[], signatureCommitment: number[], contractHash: number[] }>}
 */
async function generateProof(signerSecret, contractData) {
    validateContractData(contractData);
    return generateIntentProof(deriveSignerKey(signerSecret), contractData);
}

/**
 * Sign a contract — full pipeline
 * Signer secret -> ZK proof -> Anchor program -> on-chain verified
 *
 * @param {Uint8Array} signerSecret - at least 32 bytes from a passkey, wallet or device seed
 * @param {string|Uint8Array} contractData - The contract content to sign
 * @returns {{ verified, keyCommitment, signatureCommitment, contractHash }}
 */
async function signContract(signerSecret, contractData) {
    const proof = await generateProof(signerSecret, contractData);
    const { keyCommitment, signatureCommitment, contractHash } = proof;

    await registerContract(contractHash);
    const transaction = await submitVerifiedGroth16(contractHash, proof);

    return {
        verified: true,
        transaction,
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
 * @param {string|Uint8Array} contractData - The contract content
 * @param {number} threshold - Minimum signatures required
 * @param {number} maxSigners - Maximum signers allowed
 */
async function createMultiSigContract(contractData, threshold, maxSigners) {
    validateMultisigConfig(threshold, maxSigners);
    const contractHash = hashContract(contractData);
    await registerContract(contractHash);
    const { multisigPda, tx } = await createMultisig(contractHash, threshold, maxSigners);
    return { contractHash, threshold, maxSigners, multisigAddress: multisigPda.toString(), transaction: tx };
}

/**
 * Sign a multi-sig contract as one of N signers
 * 
 * @param {Uint8Array} signerSecret - at least 32 bytes from a passkey, wallet or device seed
 * @param {string|Uint8Array} contractData - The contract content to sign
 */
async function signMultiSig(signerSecret, contractData) {
    const proof = await generateProof(signerSecret, contractData);
    const { keyCommitment, signatureCommitment, contractHash } = proof;

    const transaction = await submitVerifiedMultiSig(contractHash, proof);

    return {
        verified: true,
        transaction,
        keyCommitment,
        signatureCommitment,
        contractHash,
        identityRevealed: false,
        dataTransmitted: false
    };
}

/**
 * Finalize a multi-sig contract once threshold is reached
 * 
 * @param {string|Uint8Array} contractData - The contract content
 */
async function finalizeMultiSigContract(contractData) {
    const contractHash = hashContract(contractData);
    const transaction = await finalizeMultisig(contractHash);
    return { finalized: true, identityRevealed: false, transaction };
}

module.exports = {
    deriveSignerKey,
    generateSignerSecret,
    generateProof,
    signContract,
    createMultiSigContract,
    signMultiSig,
    finalizeMultiSigContract,
    initializeRegistry
};
