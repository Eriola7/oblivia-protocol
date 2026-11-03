/** Browser-only passkey and local proving helpers. No wallet or transaction submission API. */
export interface ProvingAssets {
  wasmUrl: string;
  zkeyUrl: string;
}

/** Raw snarkjs Groth16 proof; not the serialized Anchor instruction bytes. */
export interface Groth16Proof {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
  protocol: string;
  curve: string;
}

export interface BrowserProofResult {
  /** SHA-256 of the exact contract bytes, encoded as 32 bytes. */
  contractHash: number[];
  proof: Groth16Proof;
  /** Four public signals encoded as decimal strings, not a 128-byte array. */
  publicInputs: string[];
  /** Local proof verification only; no transaction has been submitted. */
  verified: true;
}

export interface PasskeyOptions {
  /** Relying party ID; defaults to the current origin's domain. */
  rpId?: string;
  /** Inject a CredentialsContainer (defaults to navigator.credentials). */
  credentials?: CredentialsContainer;
}

/** Thrown when WebAuthn or its PRF extension is unavailable, or the user cancels. */
export class PasskeyUnavailableError extends Error {}

/**
 * Create a discoverable, user-verified passkey (synced by iCloud Keychain or
 * Google Password Manager where the platform supports it).
 */
export function createSignerPasskey(
  options?: PasskeyOptions & { rpName?: string; userName?: string }
): Promise<{ credentialId: string }>;

/**
 * Unlock a passkey with Face ID / Touch ID / device PIN and return its
 * 32-byte PRF secret. Discard it after deriving the signer key.
 */
export function getPasskeySecret(
  options?: PasskeyOptions & { credentialId?: string }
): Promise<Uint8Array>;

/** Derive the private circuit input (decimal field element) from a signer secret. */
export function deriveSignerKey(signerSecret: Uint8Array): string;

/** Generate and locally verify a proof using explicitly supplied circuit assets. */
export function generateProof(
  signerSecret: Uint8Array,
  contractData: string | Uint8Array,
  provingAssets: ProvingAssets
): Promise<BrowserProofResult>;
