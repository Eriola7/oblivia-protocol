/**
 * Oblivia SDK — Zero-identity contract signing for Solana.
 * MIT licensed. Free forever.
 */

/** Result of a full contract signing pipeline. */
export interface SignResult {
  /** True if the signature was verified on-chain. */
  verified: boolean;
  /** Always false — identity is never revealed. */
  identityRevealed: false;
  /** Always false — biometric data never leaves the device. */
  dataTransmitted: false;
  /** Transaction signature of the on-chain submission, if applicable. */
  transaction?: string;
  /** Hex-encoded key commitment (Pedersen hash of signing key). */
  keyCommitment?: string;
  /** Hex-encoded signature commitment (binds key, contract hash, timestamp). */
  signatureCommitment?: string;
}

/** Result of ZK proof generation. */
export interface ProofResult {
  /** Raw proof bytes. */
  proof: Uint8Array;
  /** Public inputs: [keyCommitment, signatureCommitment]. */
  publicInputs: string[];
  /** True if the proof verified locally. */
  verified: boolean;
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
 * Derive a stable cryptographic signing key from biometric features.
 * Runs entirely on-device. No data is transmitted or stored.
 * @param biometricFeatures - Array of normalized biometric measurements (e.g. facial geometry ratios).
 * @returns Hex-encoded signing key.
 */
export function deriveKey(biometricFeatures: number[]): string;

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
): Promise<{ multisigAddress: string; transaction: string }>;

/**
 * Sign a multi-signature contract as one of N anonymous signers.
 * Duplicate signatures from the same key are rejected on-chain via PDA deduplication.
 * @param biometricFeatures - The signer's biometric measurements.
 * @param contractData - The contract being signed.
 */
export function signMultiSig(
  biometricFeatures: number[],
  contractData: string | Uint8Array
): Promise<SignResult & { state: MultiSigState }>;

/**
 * Finalize a multi-signature contract once the threshold is reached.
 * Fails on-chain if the threshold has not been met.
 * @param contractData - The contract to finalize.
 */
export function finalizeMultiSigContract(
  contractData: string | Uint8Array
): Promise<{ finalized: boolean; transaction: string }>;
