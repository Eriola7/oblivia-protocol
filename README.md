# Oblivia Protocol

> **Devnet status:** the contract-bound Groth16 v2 verifier is deployed to Solana Devnet at `HaRpXyybfpYpwxkhfj8CjY8EjGqvRd96Zi33iSCTxvHG`.

Oblivia is an open-source, zero-identity contract-signing primitive for Solana. A signer proves knowledge of an on-device-derived signing key and its binding to a specific contract without publishing the key or biometric inputs.

## Security status

The Devnet program is suitable for integration testing, not production use. The current Groth16 proving key is a development artifact. A production ceremony, independent security review, release hardening, operational monitoring, and a Mainnet deployment remain future work.

No biometric sample is submitted to the protocol. The biometric client derives a local signing input; the proof system receives only that private scalar and public contract-binding data. Biometric matching and entropy guarantees have not received an independent security audit.

The reference browser's 20 quantized feature bytes each have only four possible values (at most 40 bits before hashing, potentially less in practice). Hashing does not increase this entropy. It is a demonstration input, not a production biometric credential. Multisig deduplicates **key commitments**, not people: it provides neither biometric uniqueness/liveness nor an authorized participant list. Repeated scans can produce different keys.

**Devnet proof-receipt upgrade:** deployed on September 26, 2026, at slot `504178380`. The matching relay/SDK must supply both the signer record and the verified contract-bound signature receipt when counting a multisig member. Single-signature verification is unchanged. This correctness fix is not a production security certification.

## Current architecture

```text
Facial geometry (local)
        │
        ▼
Prototype quantization + hashing → private signing scalar
        │
        ▼
Circom Groth16 circuit
  private: signer key, timestamp
  public: key commitment, signature commitment,
          SHA-256(contract)[0..15], SHA-256(contract)[16..31]
        │
        ▼
Solana v2 verifier → signature PDA → optional multisig member PDA
```

The same Groth16 relation is proven by the client and verified by the on-chain program. The program checks all four public inputs, including both 128-bit limbs of the complete SHA-256 contract hash, before recording an attestation. This prevents a valid proof from being replayed for a different contract.

## What is implemented

| Component | State |
| --- | --- |
| Contract-bound Groth16 circuit | Implemented; four public signals |
| On-chain Groth16 v2 verifier | Deployed on Devnet via Solana `alt_bn128` syscalls |
| Single-signature attestation | Implemented through `verify_groth16_v2` |
| Anonymous threshold multisig | Implemented as atomic verification plus member recording |
| Browser reference client | Builds with local, browser-side Groth16 proving |
| Node SDK | Generates and locally verifies Groth16 proofs before submission |
| Sponsored relay | Implements v2 submission endpoints with origin controls and basic in-memory rate limits |

## Repository layout

- `zk_groth16/` — Circom circuit, proving artifacts, proof serializer, and contract-binding test.
- `oblivia-contracts/` — Anchor program and the compile-time Groth16 verification-key generator.
- `sdk/` — Node and browser proof-generation entrypoints plus Anchor submission helpers.
- `browser-client/` — reference single-signature and multisig clients.
- `relay/` — sponsored Devnet relay.
- `biometric-entropy-client/` — local feature extraction and key-derivation utilities.

`zk_intent_circuit/` is retained as a historical Noir experiment. It is not used by the deployed verifier, relay, reference client, or current SDK flow.

The root `multisig_demo.js` and `witness_node.js` are also historical experiments, not supported v2 examples. The former uses the disabled commitment-only path; the latter is not a verified witness service. Use the current reference clients and SDK examples instead.

## Local verification

```bash
npm --prefix zk_groth16 run test:binding
npm run test:regressions
npm run test:multisig
npm --prefix browser-client run build
npm --prefix sdk run test:proof
```

## Devnet program

Program ID: `HaRpXyybfpYpwxkhfj8CjY8EjGqvRd96Zi33iSCTxvHG`

The current v2 entrypoints are:

- `verify_groth16_v2` — validates the Groth16 proof and atomically records the contract-bound anonymous signature.
- `record_verified_multisig` — records a verified signer for a multisig agreement and finalizes it automatically at the threshold.

Older commitment-only submission instructions are retained only for compatibility and fail closed. New integrations must use the v2 path.

The patched multisig counter requires a program-owned `SignerRecord` PDA and a verified `ObliviaSignature` receipt for the exact contract and key commitment. The relay submits verification and counting atomically. The low-level `record_verified_multisig` instruction can also count an existing verified receipt later, but only once; the current relay/SDK signing helpers always submit a fresh verification and therefore cannot reuse a key that has already signed that contract singly. The local VM tests exercise missing/forged/mismatched records and receipts, duplicate counting, threshold finalization, a real development proof, and invalid-proof rollback.

A live Devnet 2-of-2 release check accepted two fresh proofs and finalized the agreement. Read-only simulations against that test agreement rejected an unverified count and a duplicate count. [Final threshold transaction](https://explorer.solana.com/tx/2hjZ1JS93XP3DngYWpavasaY2qY1oBsspF7NxKSc9phNX2YZi5RH8N3zHQZ6Z87HvDWhdG3Ba5SV59z37QLm7rkP?cluster=devnet). Reproduce with `OBLIVIA_E2E_KEYPAIR=/absolute/path/to/test-payer.json node zk_groth16/e2e_multisig_devnet.js`; this spends Devnet SOL and creates a new test agreement.

Agreement settings are first-created and immutable for a contract hash. Relay and SDK creation reject conflicting threshold/maximum settings rather than silently reusing them. This detects conflicts; it does not prevent another party from registering settings first. Use distinct agreement text for distinct agreements. Participant eligibility and stronger agreement authorization remain unresolved design work.

## Development notes

The relay and reference clients must be deployed and configured together. Set `OBLIVIA_ALLOWED_ORIGINS` to the actual reference-app origins before exposing the relay; do not use its development configuration as production infrastructure.

## License

MIT
