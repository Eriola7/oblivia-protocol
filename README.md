# Oblivia Protocol

> **Devnet status:** the contract-bound Groth16 v2 verifier is deployed to Solana Devnet at `HaRpXyybfpYpwxkhfj8CjY8EjGqvRd96Zi33iSCTxvHG`.

Oblivia is an open-source, zero-identity contract-signing primitive for Solana. A signer proves knowledge of an on-device-derived signing key and its binding to a specific contract without publishing the key or biometric inputs.

## Security status

The Devnet program is suitable for integration testing, not production use. The current Groth16 proving key is a development artifact. A production ceremony, independent security review, release hardening, operational monitoring, and a Mainnet deployment remain future work.

No biometric sample is submitted to the protocol. The biometric client derives a local signing input; the proof system receives only that private scalar and public contract-binding data. Biometric matching and entropy guarantees have not received an independent security audit.

## Current architecture

```text
Facial geometry (local)
        │
        ▼
Fuzzy extractor → private signing scalar
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

## Local verification

```bash
npm --prefix zk_groth16 run test:binding
cd oblivia-contracts && cargo check -p oblivia-contracts
npm --prefix browser-client run build
npm --prefix sdk run test:proof
```

## Devnet program

Program ID: `HaRpXyybfpYpwxkhfj8CjY8EjGqvRd96Zi33iSCTxvHG`

The current v2 entrypoints are:

- `verify_groth16_v2` — validates the Groth16 proof and atomically records the contract-bound anonymous signature.
- `record_verified_multisig` — records a verified signer for a multisig agreement and finalizes it automatically at the threshold.

Older commitment-only submission instructions are retained only for compatibility and fail closed. New integrations must use the v2 path.

## Development notes

The relay and reference clients must be deployed and configured together. Set `OBLIVIA_ALLOWED_ORIGINS` to the actual reference-app origins before exposing the relay; do not use its development configuration as production infrastructure.

## License

MIT
