# Changelog

All notable changes to `@oblivia/sdk` are documented here. This project follows
[Semantic Versioning](https://semver.org/); while the version is `0.x`, minor
releases may contain breaking changes.

## 0.1.0 — unreleased

First npm release. Targets the Devnet v2 program `HaRpXyybfpYpwxkhfj8CjY8EjGqvRd96Zi33iSCTxvHG`.

### Added

- `generateSignerSecret()` and `deriveSignerKey(signerSecret, contractHash)` (Node).
- `createSignerPasskey()`, `getPasskeySecret()` and `deriveSignerKey()` in `@oblivia/sdk/browser`:
  Face ID / Touch ID unlocks a standard synced passkey whose WebAuthn PRF output is the signer secret.
- Offline package tests (`npm test`) covering key derivation, local Groth16 proving and full contract-hash binding.

### Changed

- **Breaking:** `generateProof`, `signContract` and `signMultiSig` take a `signerSecret: Uint8Array`
  (at least 32 bytes from a passkey, wallet or device seed) instead of biometric measurements.
- The signer key is a 248-bit domain-separated SHA-256 of the contract hash and signer secret (`oblivia/signer-key/v2`). Keys are per contract, so signatures cannot be linked across contracts.
- **Breaking:** `signMultiSig` and `finalizeMultiSigContract` take the agreement's `threshold` and `maxSigners`, which are part of its on-chain address.
- The SDK no longer loads `.env` files into the host process. Set `OBLIVIA_DEVNET_KEY` yourself;
  a missing or malformed key now fails with a clear error.

### Removed

- Biometric key derivation (`deriveKey`, the prototype fuzzy extractor and feature validation).
- The unused Noir circuit artifact.
- Dead helpers for disabled or legacy instructions (`submitSignature`, `submitMultisigSignature`, `verifySignature`).

### Security

- Development proving key: not a production ceremony output. Not audited. Devnet only.
- Multisig deduplicates key commitments, not people.
