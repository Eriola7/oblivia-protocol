/**
 * Node entry point: key derivation, local proving and Devnet submission.
 *
 * Oblivia is an on-chain Groth16 verification and contract-binding
 * primitive. Key management and backup are left to standard wallets and
 * passkeys. Submission needs `OBLIVIA_DEVNET_KEY`; proving does not.
 *
 * @packageDocumentation
 * @module @oblivia/sdk
 */
import type { PublicKey } from '@solana/web3.js';

/** Result of a full contract signing pipeline. */
export interface SignResult {
  /** True if the signature was verified on-chain. */
  verified: true;
  /** Always false — identity is never revealed. */
  identityRevealed: false;
  /** Always false — the signer secret and signer key never leave the device. */
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

/** Bytes from a passkey PRF, wallet or device seed: at least 32 bytes, not all zero. */
export type SignerSecret = Uint8Array;

/**
 * Generate a fresh 32-byte signer secret for server-side or test signers.
 * Store it in your own key store; Oblivia keeps no copy.
 */
export function generateSignerSecret(): Uint8Array;

/**
 * Derive the private circuit input for one contract.
 * Deterministic per contract: the same secret and contract always give the same
 * key, while different contracts give unrelated keys (signatures are unlinkable).
 * @param contractHash - SHA-256 of the contract bytes, 32 bytes.
 * @returns Decimal BN254 field element (248-bit).
 */
export function deriveSignerKey(signerSecret: SignerSecret, contractHash: Uint8Array | number[]): string;

/**
 * Generate a zero-knowledge proof of contract signing.
 * Proves knowledge of the signing key and binds it to the contract hash and timestamp
 * without revealing the key or the signer's identity.
 * @param signerSecret - At least 32 bytes from a passkey, wallet or device seed.
 * @param contractData - The contract content (string or bytes) to sign.
 */
export function generateProof(
  signerSecret: SignerSecret,
  contractData: string | Uint8Array
): Promise<ProofResult>;

/**
 * Full signing pipeline: derive key, generate proof, register contract,
 * and verify the proof on-chain in the same transaction that records it.
 * @param signerSecret - At least 32 bytes from a passkey, wallet or device seed.
 * @param contractData - The contract content to sign.
 */
export function signContract(
  signerSecret: SignerSecret,
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
 * Deduplication is per key, not per person: one person holding several keys
 * counts several times. Restrict eligible signers in your application.
 * @param signerSecret - At least 32 bytes from a passkey, wallet or device seed.
 * @param contractData - The contract being signed.
 * @param threshold - The agreement's threshold; with maxSigners it identifies the agreement on-chain.
 * @param maxSigners - The agreement's maximum number of signers.
 */
export function signMultiSig(
  signerSecret: SignerSecret,
  contractData: string | Uint8Array,
  threshold: number,
  maxSigners: number
): Promise<SignResult>;

/**
 * Finalize a multi-signature contract once the threshold is reached.
 * Normally unnecessary: signing auto-finalizes at the threshold.
 * Returns a null transaction if already finalized; fails if below threshold.
 * @param contractData - The contract to finalize.
 * @param threshold - The agreement's threshold.
 * @param maxSigners - The agreement's maximum number of signers.
 */
export function finalizeMultiSigContract(
  contractData: string | Uint8Array,
  threshold: number,
  maxSigners: number
): Promise<{ finalized: true; identityRevealed: false; transaction: string | null }>;

/** One-time registry initialization; already performed on Devnet. */
export function initializeRegistry(): Promise<PublicKey>;
