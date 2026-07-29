# Oblivia SDK

Zero-identity contract signing for Solana. Sign legally binding agreements with full cryptographic provability and zero identity disclosure.

MIT licensed. No fees. No token. Free forever.

## Requirements

- Node.js 18+
- A Solana keypair with devnet SOL (set `OBLIVIA_DEVNET_KEY` in a `.env` file as a hex-encoded secret key)

## Install

```bash
npm install @eriola7/oblivia-sdk
```

Until the package is published to npm, install directly from the repository:

```bash
git clone https://github.com/Eriola7/oblivia-protocol.git
cd oblivia-protocol/sdk && npm install
```

## Quick Start

```javascript
const oblivia = require('@eriola7/oblivia-sdk');

// 20 normalized biometric measurements (facial geometry ratios).
// In production these come from the browser client's face capture.
const biometricFeatures = [/* 20 values between 0 and 1 */];

// Sign a contract — derives key, generates ZK proof, registers
// on-chain, submits commitments, verifies. One call.
const result = await oblivia.signContract(biometricFeatures, 'Contract text or bytes');

console.log(result.verified);          // true
console.log(result.identityRevealed);  // false — always
console.log(result.dataTransmitted);   // false — always
console.log(result.keyCommitment);     // 0x… Pedersen commitment
```

## Anonymous Multi-Signature

```javascript
// Create a 2-of-3 multisig contract on-chain
await oblivia.createMultiSigContract(contractData, 2, 3);

// Each signer signs independently — same key cannot sign twice
// (enforced on-chain by PDA deduplication)
await oblivia.signMultiSig(signer1Features, contractData);
await oblivia.signMultiSig(signer2Features, contractData);

// Finalizes automatically once the threshold is met
await oblivia.finalizeMultiSigContract(contractData);
```

## API

| Function | Description |
|---|---|
| `deriveKey(biometricFeatures)` | Derive a stable signing key from biometrics. On-device. Never stored, never transmitted. |
| `generateProof(biometricFeatures, contractData)` | Generate a ZK proof binding the key to a specific contract and timestamp. |
| `signContract(biometricFeatures, contractData)` | Full pipeline: key → proof → register → submit → verify on-chain. |
| `createMultiSigContract(contractData, threshold, maxSigners)` | Create an anonymous M-of-N multisig contract. |
| `signMultiSig(biometricFeatures, contractData)` | Sign as one of N anonymous signers. Duplicates rejected on-chain. |
| `finalizeMultiSigContract(contractData)` | Finalize once the threshold is reached. |
| `initializeRegistry()` | One-time registry initialization (already done on devnet). |

Full TypeScript definitions ship with the package (`index.d.ts`).

## How It Works

1. **Biometric → key.** A fuzzy extractor derives a stable cryptographic key from facial geometry. Same face, same key. Different face, different key. Nothing leaves the device.
2. **Key → proof.** A Noir circuit (UltraHonk backend) proves knowledge of the key and binds it to the contract hash and timestamp — without revealing the key.
3. **Proof → chain.** Commitments are stored on the Oblivia Anchor program. A Groth16 verifier checks proofs fully on-chain via Solana's alt_bn128 syscalls.

**Program ID (devnet):** `HaRpXyybfpYpwxkhfj8CjY8EjGqvRd96Zi33iSCTxvHG`

## Zero Identity Guarantee

- Biometric data: never transmitted, never stored
- Signer identity: never revealed — only Pedersen commitments go on-chain
- Proofs: cryptographically verifiable by anyone, on Solana
- Cost: free forever

## License

MIT
