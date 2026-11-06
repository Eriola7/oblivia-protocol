# Changelog

Notable protocol-level changes. SDK releases have their own log in [sdk/CHANGELOG.md](sdk/CHANGELOG.md). The full history is in the git log.

## Unreleased

### Added
- The relay enforces a daily spending budget and a balance floor for its fee payer (`OBLIVIA_SPONSOR_DAILY_SOL`, `OBLIVIA_SPONSOR_MIN_SOL`), so abuse of the public relay has a bounded cost.

## 2026-11-05 — Devnet upgrade

Deployed at slot `518923390`.

### Removed
- The v1 `verify_groth16` instruction.

### Changed
- **Breaking:** an agreement's threshold and signer count are part of its on-chain address, so nobody can create a contract's agreement first with other settings. Share links and relay status lookups carry the settings.
- **Breaking:** signer keys now come from a passkey (WebAuthn PRF) or a caller-supplied secret, not from biometric measurements. Face ID / Touch ID only unlocks the passkey, and backup and recovery come from the platform keychain. Existing signatures remain valid; signers get new key commitments.
- Signer keys are derived per contract, so one signer's signatures on different contracts cannot be linked.
- `@oblivia/sdk` is installable as a standalone package.
- The Devnet smoke test now simulates well-formed forged and replayed proofs, uses random signers, and reports only observed results.

### Added
- A documentation site (MkDocs Material, Read the Docs) with generated SDK and program references, a relay API reference and tested examples. CI builds it in strict mode.
- Adversarial proof-verification tests: malformed encodings, off-curve and identity points, non-canonical inputs, and well-formed forgeries. They run in CI without a Solana toolchain.
- The reference clients require a permanent passkey domain (`OBLIVIA_RP_ID`) before creating or unlocking signers. Explicit test builds (`OBLIVIA_PASSKEY_TEST=1`) are labelled as temporary.
- The reference clients build in production mode with a strict Content Security Policy and no inline event handlers.
- Production trusted-setup tooling and plan ([docs/CEREMONY.md](docs/CEREMONY.md)), audit scope, and threat model.
- CI for tests, the packaged SDK, the browser build and the program build.
- Contributing guide, security policy, code of conduct, support guide, and issue and pull request templates.

### Removed
- Biometric key derivation and the face-landmark model.
- The 40-bit entropy claim.
- Legacy experiments from `main` (Noir circuit, v1 scripts, root duplicates). They are preserved on `archive/legacy-experiments`.

## 2026-09-26 — Devnet proof-receipt upgrade

Deployed at slot `504178380`.

### Fixed
- Multisig counting requires both a program-owned signer record and a verified, contract-bound signature receipt for the exact contract and key commitment.

## 2026-09-18 — Groth16 v2

### Changed
- Proofs are bound to the full SHA-256 contract hash through two 128-bit public inputs, and the program checks both before verifying.
- `verify_groth16_v2` verifies and records signatures atomically.
- Commitment-only submission instructions fail closed.
- Circom Groth16 became the only signing path; the earlier Noir/Barretenberg path is no longer used.
