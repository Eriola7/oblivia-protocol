# Independent security review: scope

Oblivia has not been audited. This is the scope we will put to an external reviewer before any Mainnet deployment. It is a funded milestone, not completed work.

## In scope

**Circuit** (`zk_groth16/oblivia.circom`)
- Soundness of the relation: key commitment, signature commitment and both contract-hash limbs.
- Under-constrained signals, including the non-zero checks on `signer_key` and `timestamp`.
- Whether 128-bit limbs need explicit range constraints given the program-side comparison.

**Solana program** (`oblivia-contracts/`)
- `verify_groth16_v2`: proof deserialization, public-input ordering, contract-hash limb comparison, atomic PDA creation.
- `record_verified_multisig`: signer-record and signature-receipt provenance, duplicate counting, threshold finalization.
- `create_multisig`: first-writer-wins agreement settings and front-running exposure.
- Remaining fail-closed legacy instructions (`submit_signature`, `submit_multisig_signature`) and whether to remove them. The v1 `verify_groth16` has been removed from source.
- Coverage of `tests/proof_verification.rs`: malformed encodings, off-curve and identity points, non-canonical inputs, and well-formed forgeries.
- Account sizing, PDA seeds, overflow behaviour.

**Proving key embedding**
- `build.rs` conversion from `verification_key.json` to the on-chain verifying key, including G2 coordinate ordering.

**Clients**
- SDK proof serialization (`sdk/lib/groth16_intent.js`) and G1 negation.
- Signer key derivation (`sdk/lib/signer_key.js`) and passkey PRF handling (`sdk/lib/passkey.js`).
- Relay input validation, CORS and rate limiting (`relay/server.js`).

## Out of scope

- Passkey and wallet providers themselves (iCloud Keychain, Google Password Manager, hardware wallets). Oblivia relies on them for key storage and recovery; see [THREAT_MODEL.md](THREAT_MODEL.md).
- Human uniqueness. Oblivia does not claim it.
- Legal enforceability of signed agreements.

## Deliverables we expect

- Findings report with severity ratings.
- Fix review of every High and Critical finding.
- Public report published in this repository.
