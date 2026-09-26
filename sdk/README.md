# Oblivia SDK

Development SDK for contract-bound, anonymous signing on Solana Devnet. This is not an audited production SDK; proof verification does not establish a signer's legal identity or an agreement's legal enforceability.

MIT licensed. No protocol fee or token. Direct SDK transactions require a fee payer with Devnet SOL.

## Requirements

- Node.js 18+
- A Solana keypair with devnet SOL (set `OBLIVIA_DEVNET_KEY` in a `.env` file as a hex-encoded secret key)

## Install

Use the checked-out SDK; these examples do not assume an npm publication:

```bash
git clone https://github.com/Eriola7/oblivia-protocol.git
cd oblivia-protocol/sdk && npm install
```

## Quick Start

```javascript
// Run from the repository's sdk directory.
const oblivia = require('./index.js');

// 20 normalized biometric measurements (facial geometry ratios).
// The reference browser client obtains these from local face capture.
const biometricFeatures = [/* 20 values between 0 and 1 */];

// Sign a contract — derives key, generates ZK proof, registers
// on-chain, submits commitments, verifies. One call.
const result = await oblivia.signContract(biometricFeatures, 'Contract text or bytes');

console.log(result.verified);          // true
console.log(result.identityRevealed);  // false — always
console.log(result.dataTransmitted);   // false refers to biometric data, not the proof
console.log(result.transaction);       // confirmed Devnet transaction signature
console.log(result.keyCommitment);     // 32-byte number[] commitment
```

## Anonymous Multi-Signature

```javascript
// Create a 2-of-3 multisig contract on-chain
await oblivia.createMultiSigContract(contractData, 2, 3);

// Each signer signs independently — same key cannot sign twice
// (enforced on-chain by PDA deduplication)
await oblivia.signMultiSig(signer1Features, contractData);
await oblivia.signMultiSig(signer2Features, contractData);

// The second signature automatically finalizes this 2-of-3 agreement.
// No additional finalization transaction is required.
```

## API

| Function | Description |
|---|---|
| `deriveKey(biometricFeatures)` | Returns `{ key, sketch }`, both hex strings, derived locally. Stability and uniqueness are not established guarantees. |
| `generateProof(biometricFeatures, contractData)` | Generate a ZK proof binding the key to a specific contract and timestamp. |
| `signContract(biometricFeatures, contractData)` | Full pipeline: key → proof → register → submit → verify on-chain. |
| `createMultiSigContract(contractData, threshold, maxSigners)` | Returns the contract hash, settings, multisig address and transaction; transaction is `null` if the matching configuration already exists. |
| `signMultiSig(biometricFeatures, contractData)` | Returns commitments, contract hash and a confirmed transaction. It does not fetch or return a `state` object. Deduplication is per key, not per person. |
| `finalizeMultiSigContract(contractData)` | Normally unnecessary because signing auto-finalizes. Returns a `null` transaction if already finalized; fails below threshold. |
| `initializeRegistry()` | One-time registry initialization (already done on devnet). |

Full TypeScript definitions ship with the package (`index.d.ts`).

Contract data accepts a UTF-8 string or exact `Uint8Array` bytes. The Node entry point returns byte arrays for hashes and commitments. The separate `@oblivia/sdk/browser` entry point exposes local proving helpers, not the Node submission API; its `deriveKey` returns the key string directly.

## How It Works

1. **Biometric → key.** The prototype extractor derives a key from local facial geometry. Stability, entropy, liveness and distinct-human uniqueness have not been established. Biometric features are not included in the submission.
2. **Key → proof.** A Circom Groth16 circuit proves knowledge of the key and binds it to the full SHA-256 contract hash and timestamp — without revealing the key.
3. **Proof → chain.** Commitments are stored on the Oblivia Anchor program. A Groth16 verifier checks proofs fully on-chain via Solana's alt_bn128 syscalls.

**Program ID (devnet):** `HaRpXyybfpYpwxkhfj8CjY8EjGqvRd96Zi33iSCTxvHG`

## Data flow and limitations

- Biometric data: never transmitted, never stored
- Submission: proofs, public commitments and the contract hash are sent to the relay or chain; biometric features and the private signing scalar are not
- Proofs: cryptographically verifiable by anyone, on Solana
- Deduplication is per derived key and contract, not a guarantee of one signature per human
- The proving setup is a development artifact; see the repository README for prototype limitations

## License

MIT
