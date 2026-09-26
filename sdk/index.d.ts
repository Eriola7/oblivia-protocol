/**
 * Oblivia SDK — Zero-identity contract signing for Solana.
 * MIT licensed. Free forever.
 */
import type { PublicKey } from '@solana/web3.js';

/** Result of a full contract signing pipeline. */
export interface SignResult {
  /** True if the signature was verified on-chain. */
  verified: true;
  /** Always false — identity is never revealed. */
  identityRevealed: false;
  /** Always false — biometric data never leaves the device. */
  dataTransmitted: false;
  /** Confirmed transaction signature of the on-chain submission. */
  transaction: string;
  /** SHA-256 contract hash, encoded as 32 bytes. */
  contractHash: number[];
  /** Key commitment, encoded as 32 bytes. */
  keyCommitment: number[];
  /** Signature commitment, encoded as 32 bytes. */
  signatureCommitment: number[];
}

/** Result of ZK proof generation. */
export interface ProofResult {
  /** Canonical SHA-256 contract hash. */
  contractHash: number[];
  /** Groth16 proof encoded for the Anchor verifier. */
  proofA: number[];
  proofB: number[];
  proofC: number[];
  /** Public inputs: key, signature, contract-hash low limb, high limb. */
  publicInputs: number[];
  keyCommitment: number[];
  signatureCommitment: number[];
}

/** Multi-signature contract state. */
export interface MultiSigState {
  /** Number of signatures collected so far. */
  signaturesCollected: number;
  /** Signatures required for finalization. */
  threshold: number;
  /** True once the threshold is reached and the contract is finalized. */
  finalized: boolean;
}

/**
 * Derive a prototype signing key from biometric features.
 * Runs entirely on-device. No data is transmitted or stored.
 * @param biometricFeatures - Array of normalized biometric measurements (e.g. facial geometry ratios).
 * Stability, biometric entropy, and uniqueness are not established guarantees.
 * @returns Hex-encoded signing key and reconstruction sketch.
 */
export function deriveKey(biometricFeatures: number[]): { key: string; sketch: string };

/**
 * Generate a zero-knowledge proof of contract signing.
 * Proves knowledge of the signing key and binds it to the contract hash and timestamp
 * without revealing the key or the signer's identity.
 * @param biometricFeatures - Biometric measurements used to derive the signing key.
 * @param contractData - The contract content (string or bytes) to sign.
 */
export function generateProof(
  biometricFeatures: number[],
  contractData: string | Uint8Array
): Promise<ProofResult>;

/**
 * Full signing pipeline: derive key, generate proof, register contract,
 * submit ZK commitments on-chain, and verify.
 * @param biometricFeatures - Biometric measurements used to derive the signing key.
 * @param contractData - The contract content to sign.
 */
export function signContract(
  biometricFeatures: number[],
  contractData: string | Uint8Array
): Promise<SignResult>;

/**
 * Create an anonymous M-of-N multi-signature contract on-chain.
 * @param contractData - The contract content.
 * @param threshold - Signatures required to finalize (M).
 * @param maxSigners - Maximum number of signers (N).
 */
export function createMultiSigContract(
  contractData: string | Uint8Array,
  threshold: number,
  maxSigners: number
): Promise<{
  contractHash: number[];
  threshold: number;
  maxSigners: number;
  multisigAddress: string;
  /** Null when the same agreement configuration already exists. */
  transaction: string | null;
}>;

/**
 * Sign a multi-signature contract as one of N anonymous signers.
 * Duplicate signatures from the same key are rejected on-chain via PDA deduplication.
 * @param biometricFeatures - The signer's biometric measurements.
 * @param contractData - The contract being signed.
 */
export function signMultiSig(
  biometricFeatures: number[],
  contractData: string | Uint8Array
): Promise<SignResult>;

/**
 * Finalize a multi-signature contract once the threshold is reached.
 * Normally unnecessary: signing auto-finalizes at the threshold.
 * Returns a null transaction if already finalized; fails if below threshold.
 * @param contractData - The contract to finalize.
 */
export function finalizeMultiSigContract(
  contractData: string | Uint8Array
): Promise<{ finalized: true; identityRevealed: false; transaction: string | null }>;

/** One-time registry initialization; already performed on Devnet. */
export function initializeRegistry(): Promise<PublicKey>;
