/** Browser-only local proving helpers. No wallet or transaction submission API. */
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

/** Derive a hex key from exactly 20 finite local measurements in [0, 1]. */
export function deriveKey(biometricFeatures: number[]): string;

/** Generate and locally verify a proof using explicitly supplied circuit assets. */
export function generateProof(
  biometricFeatures: number[],
  contractData: string | Uint8Array,
  provingAssets: ProvingAssets
): Promise<BrowserProofResult>;
