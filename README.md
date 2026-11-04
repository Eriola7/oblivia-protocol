# Oblivia Protocol

[![CI](https://github.com/Eriola7/oblivia-protocol/actions/workflows/ci.yml/badge.svg)](https://github.com/Eriola7/oblivia-protocol/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Network: Solana Devnet](https://img.shields.io/badge/network-Solana%20Devnet-9945FF)
![Status: unaudited](https://img.shields.io/badge/status-unaudited-orange)

> **Devnet status:** the contract-bound Groth16 v2 verifier is deployed to Solana Devnet at `HaRpXyybfpYpwxkhfj8CjY8EjGqvRd96Zi33iSCTxvHG`.

Oblivia is an open-source, zero-identity contract-signing primitive for Solana: on-chain Groth16 verification plus contract binding. A signer proves knowledge of a private signing key and its binding to the exact bytes of a contract without publishing the key.

Oblivia does not manage keys. In the browser, Face ID / Touch ID only unlocks a standard passkey, and the passkey supplies the signing secret. Backup and recovery come from the platform keychain (iCloud Keychain, Google Password Manager) or the integrator's wallet or key store.

## Security status

The Devnet program is suitable for integration testing, not production use.

| Item | Status |
| --- | --- |
| Groth16 proving key | Development artifact from a single-party setup. Production ceremony planned: [docs/CEREMONY.md](docs/CEREMONY.md) |
| Independent audit | Not yet done. Scope: [docs/AUDIT_SCOPE.md](docs/AUDIT_SCOPE.md) |
| Key management | Delegated to passkeys / wallets. Oblivia stores no keys and runs no recovery service |
| Human uniqueness | Not provided. Multisig deduplicates **key commitments, not people**: one person with several passkeys counts several times |
| Mainnet | Not deployed |

Read [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) for what the protocol does and does not protect.

**Devnet proof-receipt upgrade:** deployed on September 26, 2026, at slot `504178380`. The matching relay/SDK must supply both the signer record and the verified contract-bound signature receipt when counting a multisig member. Single-signature verification is unchanged. This correctness fix is not a production security certification.

## Current architecture

```text
Face ID / Touch ID unlocks a synced passkey (local)
        │  WebAuthn PRF output (32 bytes)
        ▼
Domain-separated SHA-256 → 248-bit private signing scalar
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
| Browser reference client | Passkey unlock (WebAuthn PRF) and local, browser-side Groth16 proving |
| Node SDK (`@oblivia/sdk`) | Generates and locally verifies Groth16 proofs before submission; installable as a standalone package |
| Sponsored relay | Implements v2 submission endpoints with origin controls and basic in-memory rate limits |

## Repository layout

- `zk_groth16/` — Circom circuit, proving artifacts, proof serializer, and contract-binding test.
- `oblivia-contracts/` — Anchor program and the compile-time Groth16 verification-key generator.
- `zk_groth16/ceremony/` — production trusted-setup tooling.
- `sdk/` — `@oblivia/sdk`: Node and browser entry points, passkey helpers, Anchor submission helpers.
- `browser-client/` — reference single-signature and multisig clients.
- `relay/` — sponsored Devnet relay.
- `docs/` — [specification](docs/SPEC.md), [technical specification](docs/TECHNICAL_SPECIFICATION.md), [architecture](docs/ARCHITECTURE.md), [threat model](docs/THREAT_MODEL.md), [ceremony plan](docs/CEREMONY.md) and [audit scope](docs/AUDIT_SCOPE.md).

Earlier experiments (the Noir circuit, biometric key derivation, the v1 verifier scripts and the draft document schema) live on the `archive/legacy-experiments` branch. None of them are used by the deployed program, relay, clients or SDK.

## Local verification

Run these commands from the repository root. The packages have separate lockfiles; a root-only `npm ci` does **not** install the SDK, relay, or circuit-test dependencies.

```bash
npm run setup:test
npm test
```

`setup:test` runs `npm ci` in the root, `sdk/`, `relay/`, and `zk_groth16/`. `npm test` runs the JavaScript regressions, SDK TypeScript interface checks, and real local Groth16 contract-binding checks. Neither command submits transactions or requires a wallet. Use Node.js 22.14+ for the complete development setup, including the browser build. CI runs the same checks on every push ([workflow](.github/workflows/ci.yml)).

Additional checks:

```bash
npm --prefix sdk test
npm --prefix sdk run test:proof
npm --prefix browser-client ci
npm run build:browser
```

Program checks require the Rust, Anchor, and Solana build toolchains separately; `setup:test` does not install them:

```bash
npm run test:program
npm run test:multisig
```

## Devnet program

Program ID: `HaRpXyybfpYpwxkhfj8CjY8EjGqvRd96Zi33iSCTxvHG`

The current v2 entrypoints are:

- `verify_groth16_v2` — validates the Groth16 proof and atomically records the contract-bound anonymous signature.
- `record_verified_multisig` — records a verified signer for a multisig agreement and finalizes it automatically at the threshold.

Older instructions are retained only so the deployed program and IDL stay in sync: the commitment-only `submit_signature` and `submit_multisig_signature` fail closed, and the v1 `verify_groth16` verifies a superseded, non-contract-bound key without recording anything. New integrations must use the v2 path.

The patched multisig counter requires a program-owned `SignerRecord` PDA and a verified `ObliviaSignature` receipt for the exact contract and key commitment. The relay submits verification and counting atomically. The low-level `record_verified_multisig` instruction can also count an existing verified receipt later, but only once; the current relay/SDK signing helpers always submit a fresh verification and therefore cannot reuse a key that has already signed that contract singly. The local VM tests exercise missing/forged/mismatched records and receipts, duplicate counting, threshold finalization, a real development proof, and invalid-proof rollback.

**Devnet smoke test.** `zk_groth16/e2e_multisig_devnet.js` creates a fresh 2-of-2 agreement with two random signers whose keys go through the SDK's key derivation. Before anything is counted, it simulates (never sends) four well-formed attacks against that agreement. Each must be rejected with `InvalidProof`, and the simulations must leave no state behind:

- a genuine proof with a substituted public input
- a proof swapped between signers
- mixed proof points
- a valid proof replayed from another contract

The proof points are valid curve points, so the first three can only fail at the pairing check and the replay at the contract-hash comparison (`tests/release_check_cases.test.js` checks this offline). The script also checks a count with no verification at all, which shows the counting gate exists but does not test proofs. It then signs both genuine signers, rejects a duplicate count and confirms finalization. Every value in its JSON output is observed, not hard-coded, and it exits non-zero if any check fails.

This is a smoke test of the deployed program, not a security audit. The forged-proof checks were added after the last recorded run ([final threshold transaction](https://explorer.solana.com/tx/2hjZ1JS93XP3DngYWpavasaY2qY1oBsspF7NxKSc9phNX2YZi5RH8N3zHQZ6Z87HvDWhdG3Ba5SV59z37QLm7rkP?cluster=devnet)) and have not yet been run against Devnet. Reproduce with `OBLIVIA_E2E_KEYPAIR=/absolute/path/to/test-payer.json node zk_groth16/e2e_multisig_devnet.js`; this spends Devnet SOL and creates a new test agreement.

Agreement settings are first-created and immutable for a contract hash. Relay and SDK creation reject conflicting threshold/maximum settings rather than silently reusing them. This detects conflicts; it does not prevent another party from registering settings first. Use distinct agreement text for distinct agreements. Participant eligibility and stronger agreement authorization remain unresolved design work.

## Development notes

The relay and reference clients must be deployed and configured together. The reference relay is publicly callable and has no API-key authentication. Set `OBLIVIA_ALLOWED_ORIGINS` to the actual reference-app origins; CORS restricts browser access, not arbitrary clients. Basic in-memory rate limits are not production sponsorship or abuse protection. Do not use this Devnet configuration as production infrastructure.

## Contributing and support

- [CONTRIBUTING.md](CONTRIBUTING.md) — setup, conventions and review process
- [SECURITY.md](SECURITY.md) — report vulnerabilities privately; do not open public issues for them
- [SUPPORT.md](SUPPORT.md) — getting help and common problems
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- [CHANGELOG.md](CHANGELOG.md)

## Built with

Circom and snarkjs (Groth16 on BN254) · Solana and Anchor (Rust) · Node.js · WebAuthn passkeys

## License

[MIT](LICENSE)
