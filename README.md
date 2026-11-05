# Oblivia Protocol

[![CI](https://github.com/Eriola7/oblivia-protocol/actions/workflows/ci.yml/badge.svg)](https://github.com/Eriola7/oblivia-protocol/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Network: Solana Devnet](https://img.shields.io/badge/network-Solana%20Devnet-9945FF)

> **Devnet status:** the contract-bound Groth16 v2 verifier is deployed to Solana Devnet at `HaRpXyybfpYpwxkhfj8CjY8EjGqvRd96Zi33iSCTxvHG`.

Oblivia is an open-source, zero-identity contract-signing primitive for Solana: on-chain Groth16 verification plus contract binding. A signer proves knowledge of a private signing key and its binding to the exact bytes of a contract without publishing the key.

Oblivia does not manage keys. In the browser, Face ID / Touch ID only unlocks a standard passkey, and the passkey supplies the signing secret. Backup and recovery come from the platform keychain (iCloud Keychain, Google Password Manager) or the integrator's wallet or key store.

## Status

| Item | Status |
| --- | --- |
| Network | Solana Devnet, program `HaRpXyybfpYpwxkhfj8CjY8EjGqvRd96Zi33iSCTxvHG` |
| On-chain proof verification | Live: proofs are verified and recorded atomically |
| Groth16 proving key | Development setup; production ceremony scheduled: [docs/CEREMONY.md](docs/CEREMONY.md) |
| Audit | Scope defined: [docs/AUDIT_SCOPE.md](docs/AUDIT_SCOPE.md) |
| Key management | Passkeys and wallets; Oblivia stores no keys |
| Mainnet | On the roadmap |

The security model is in [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).

**Devnet upgrades:** November 5, 2026, at slot `518923390` (agreement settings in the multisig address; v1 verifier removed). September 26, 2026, at slot `504178380` (counting a multisig member requires both the signer record and the verified contract-bound signature receipt).

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
- `docs/` — [specification](docs/SPEC.md), [technical specification](docs/TECHNICAL_SPECIFICATION.md), [architecture](docs/ARCHITECTURE.md), [threat model](docs/THREAT_MODEL.md), [ceremony plan](docs/CEREMONY.md), [contributor guide](docs/CEREMONY_CONTRIBUTOR.md), [deployment runbook](docs/DEPLOYMENT.md) and [audit scope](docs/AUDIT_SCOPE.md).

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
npm run test:program      # cargo check + adversarial proof-verification tests (no Solana toolchain needed)
npm run test:multisig
```

## Devnet program

Program ID: `HaRpXyybfpYpwxkhfj8CjY8EjGqvRd96Zi33iSCTxvHG`

The current v2 entrypoints are:

- `verify_groth16_v2` — validates the Groth16 proof and atomically records the contract-bound anonymous signature.
- `record_verified_multisig` — records a verified signer for a multisig agreement and finalizes it automatically at the threshold.

The v1 `verify_groth16` instruction, which checked proofs against a superseded key that was not bound to a contract, has been **removed from the program source**. It is no longer in the deployed Devnet program. The commitment-only `submit_signature` and `submit_multisig_signature` remain and fail closed. New integrations must use the v2 path.

The patched multisig counter requires a program-owned `SignerRecord` PDA and a verified `ObliviaSignature` receipt for the exact contract and key commitment. The relay submits verification and counting atomically. The low-level `record_verified_multisig` instruction can also count an existing verified receipt later, but only once; the current relay/SDK signing helpers always submit a fresh verification and therefore cannot reuse a key that has already signed that contract singly. The local VM tests exercise missing/forged/mismatched records and receipts, duplicate counting, threshold finalization, a real development proof, and invalid-proof rollback.

**Devnet smoke test.** `zk_groth16/e2e_multisig_devnet.js` creates a fresh 2-of-2 agreement with two random signers whose keys go through the SDK's key derivation. Before anything is counted, it simulates (never sends) four well-formed attacks against that agreement. Each must be rejected with `InvalidProof`, and the simulations must leave no state behind:

- a genuine proof with a substituted public input
- a proof swapped between signers
- mixed proof points
- a valid proof replayed from another contract

The proof points are valid curve points, so the first three can only fail at the pairing check and the replay at the contract-hash comparison (`tests/release_check_cases.test.js` checks this offline). The script also checks a count with no verification at all, which shows the counting gate exists but does not test proofs. It then signs both genuine signers, rejects a duplicate count and confirms finalization. Every value in its JSON output is observed, not hard-coded, and it exits non-zero if any check fails.

**Latest run (5 November 2026, after the upgrade; all 10 checks passed).**

- The three forged proofs were rejected at the pairing verification (`verify_groth16_v2.rs:54`).
- The replayed proof was rejected at the contract-hash comparison (`verify_groth16_v2.rs:41`).
- A count with no verification was rejected for a missing signer record.
- No state or receipt was left behind by any rejected attempt.
- A duplicate count was rejected.
- The agreement finalized at 2 of 2.

Transactions: [setup](https://explorer.solana.com/tx/b2SqThNDEUDZDxXXpcVx7buVZJooyzXNDUiri5Ts1zEiRW6XwuaJYyB4Gyt68AmcGMa3qtsyS7sDJ3PJQf1TJ3b?cluster=devnet), [signer 1](https://explorer.solana.com/tx/59UoFNeQc6v2sSCKUuPT6xrzU1Bkn3icc4akcW33tzwShiLxRVbBGF81dRzfjtjYGvn8dGzc8nMZ9XR9H5EhdLM?cluster=devnet), [signer 2, finalizing](https://explorer.solana.com/tx/2Gf8tpjnmdAEbWuk8a6tVDBVhKyz6dgUrePTiBhgN2FYBdUkxHxEyjgeYL51eE9AbcWUTuoHqH4BzR1QmWbqZ8Gj?cluster=devnet); [agreement account](https://explorer.solana.com/address/DtT6hMk7V5x5TJ7iQ4gvuEemCuuW6d55kP3MUg3h9FCB?cluster=devnet).

Reproduce with `OBLIVIA_E2E_KEYPAIR=/absolute/path/to/test-payer.json node zk_groth16/e2e_multisig_devnet.js`; this spends Devnet SOL and creates a new test agreement.

An agreement's threshold and maximum signer count are part of its on-chain address. The same contract with different settings is a separate agreement, so nobody can claim a contract's agreement first with settings its creator did not choose. Share links, status lookups and signatures always carry the settings. Agreements created before the November 5 upgrade use the old address format. Participant eligibility (who may sign) remains the integrating application's responsibility.

## Passkey domain

A passkey belongs to one domain (its relying-party ID). Signers created on a temporary address cannot be used after the app moves, so the reference clients refuse to create or unlock passkeys unless the build names the permanent production domain:

```bash
OBLIVIA_RP_ID=example.com npm --prefix browser-client run build   # production: signers bound to example.com
OBLIVIA_PASSKEY_TEST=1 npm --prefix browser-client run build      # throwaway test signers on any host, clearly labelled
```

A production build works on that domain and any of its subdomains (`sign.example.com`, `app.example.com`), so the app can move between subdomains without changing anyone's signer. On any other host it refuses before contacting the passkey provider. Local development on `localhost` needs neither variable.

**Choose and own the production domain before creating real signers.** Changing it later gives every user a new signer identity. Past signatures stay valid on-chain, but continuity is lost.

## Development notes

The relay and reference clients must be deployed and configured together. The reference relay is publicly callable and has no API-key authentication. Set `OBLIVIA_ALLOWED_ORIGINS` to the actual reference-app origins; CORS restricts browser access, not arbitrary clients. Basic in-memory rate limits are not production sponsorship or abuse protection. Do not use this Devnet configuration as production infrastructure.

## Documentation

The `docs/` folder is also built into a documentation site with MkDocs Material, hosted on Read the Docs. It covers getting started, the SDK guide, generated SDK and program references, the relay API, the protocol spec and the security model. The references are generated from the code on every build, and CI builds the site in strict mode on every pull request.

```bash
npm ci --prefix sdk && npm ci --prefix tools/docs && pip install -r tools/docs/requirements.txt
npm run docs:serve    # live preview at http://127.0.0.1:8000
```

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
