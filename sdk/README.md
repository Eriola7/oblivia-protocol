# Oblivia SDK

Development SDK for contract-bound, anonymous signing on Solana Devnet: on-chain Groth16 verification plus contract binding. It is not an audited production SDK; proof verification does not establish a signer's legal identity or an agreement's legal enforceability.

Oblivia does not manage keys. You supply a signer secret from a standard key store: a passkey in the browser, or a wallet / device seed / KMS secret on a server. Backup and recovery are whatever that key store provides.

MIT licensed. No protocol fee or token. Direct SDK transactions require a fee payer with Devnet SOL.

## Requirements

- Node.js 22.14.0+ (matches the repository setup and supports the locked dependencies' CommonJS-to-ESM imports)
- For on-chain submission only: a Solana keypair with Devnet SOL in `OBLIVIA_DEVNET_KEY` (hex-encoded 64-byte secret key). The SDK does not read `.env` files; load your environment yourself, e.g. `node --env-file=.env app.js`.

## Install

```bash
npm install @oblivia/sdk
```

No monorepo clone is needed. Proof generation works offline; only submission needs RPC access and a fee payer.

## Quick start (Node)

```javascript
const oblivia = require('@oblivia/sdk');

// Create once, then keep it in your own key store (OS keychain, KMS, wallet).
const signerSecret = oblivia.generateSignerSecret(); // Uint8Array(32)

// Derive key -> generate and locally verify a ZK proof -> register the contract
// -> verify the proof on-chain and record the signature, in one call.
const result = await oblivia.signContract(signerSecret, 'Contract text or bytes');

console.log(result.verified);          // true
console.log(result.identityRevealed);  // false
console.log(result.transaction);       // confirmed Devnet transaction signature
console.log(result.keyCommitment);     // 32-byte public commitment to your signer key
```

## Quick start (browser, passkey)

Face ID / Touch ID / the device PIN unlocks a standard passkey. The passkey's WebAuthn PRF output is the signer secret. Passkeys sync through iCloud Keychain or Google Password Manager, so a new device signed into the same account restores the same signer. Oblivia never sees biometric data.

```javascript
import { createSignerPasskey, getPasskeySecret, generateProof } from '@oblivia/sdk/browser';

await createSignerPasskey({ rpName: 'My App' });   // once per user
const secret = await getPasskeySecret();            // prompts Face ID / Touch ID
const result = await generateProof(secret, contractText, {
  wasmUrl: '/proving/oblivia.wasm',
  zkeyUrl: '/proving/oblivia_1.zkey',
});
secret.fill(0);
// Submit result through your relay; see browser-client/ in the repository.
```

Passkey providers without WebAuthn PRF support fail closed with `PasskeyUnavailableError`.

## Anonymous multi-signature

```javascript
// Create a 2-of-3 multisig contract on-chain
await oblivia.createMultiSigContract(contractData, 2, 3);

// Each signer signs with their own secret. The same key cannot be counted twice
// (enforced on-chain by PDA deduplication).
// The settings identify the agreement (they are part of its on-chain address).
await oblivia.signMultiSig(signer1Secret, contractData, 2, 3);
await oblivia.signMultiSig(signer2Secret, contractData, 2, 3);

// The second signature automatically finalizes this 2-of-3 agreement.
```

**Deduplication is per key, not per person.** One person holding several secrets can sign several times. If your agreement needs one-person-one-signature, restrict which key commitments may participate in your application.

## API

| Function | Description |
|---|---|
| `generateSignerSecret()` | Fresh 32-byte secret for server or test signers. Store it yourself. |
| `deriveSignerKey(signerSecret, contractHash)` | Per-contract private circuit input (decimal 248-bit field element). Same secret and contract give the same key; different contracts give unrelated keys. |
| `generateProof(signerSecret, contractData)` | Generate and locally verify a proof binding the key to the full contract hash and a timestamp. |
| `signContract(signerSecret, contractData)` | Full pipeline: key → proof → register → verify and record on-chain. |
| `createMultiSigContract(contractData, threshold, maxSigners)` | Returns the contract hash, settings, multisig address and transaction; transaction is `null` if the matching configuration already exists. |
| `signMultiSig(signerSecret, contractData, threshold, maxSigners)` | Returns commitments, contract hash and a confirmed transaction. It does not fetch or return a `state` object. |
| `finalizeMultiSigContract(contractData, threshold, maxSigners)` | Normally unnecessary because signing auto-finalizes. Returns a `null` transaction if already finalized; fails below threshold. |
| `initializeRegistry()` | One-time registry initialization (already done on Devnet). |

Browser entry point (`@oblivia/sdk/browser`): `createSignerPasskey`, `getPasskeySecret`, `deriveSignerKey`, `generateProof`, `PasskeyUnavailableError`. It takes explicit proving-asset URLs and does not expose the Node submission methods.

`signerSecret` must be a `Uint8Array` (or `Buffer`) of at least 32 bytes and not all zeros; anything else is rejected before proving. Contract data accepts a UTF-8 string or exact `Uint8Array` bytes. TypeScript definitions ship for both entry points.

## How it works

1. **Secret + contract → key.** `SHA-256("oblivia/signer-key/v2" ‖ 0x00 ‖ contractHash ‖ secret)`, truncated to 248 bits so it always fits the BN254 field. Keys are per contract, so signatures cannot be linked across contracts.
2. **Key → proof.** A Circom Groth16 circuit proves knowledge of the key and binds it to the full SHA-256 contract hash (two 128-bit limbs) and a timestamp, without revealing the key.
3. **Proof → chain.** The Oblivia program verifies the proof on-chain with Solana's `alt_bn128` syscalls and records the signature in the same instruction.

**Program ID (Devnet):** `HaRpXyybfpYpwxkhfj8CjY8EjGqvRd96Zi33iSCTxvHG`

## Data flow and limitations

- Signer secret and signer key: never transmitted, never stored by Oblivia.
- Submitted: proofs, public commitments and the contract hash.
- Key commitments are per contract, so a signer's signatures on different contracts cannot be linked to each other, and the protocol cannot prove that one signer signed both.
- The proving setup is a development artifact pending a production ceremony. Not audited. See the repository's `docs/THREAT_MODEL.md`.

## License

MIT
