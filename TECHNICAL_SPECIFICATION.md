# Oblivia Technical Specification

## Proof system

Oblivia Devnet v2 uses a Circom Groth16 circuit on BN254. Proofs are produced with `snarkjs` and verified on Solana using the `alt_bn128` syscalls through the Anchor program.

The client and chain use the same circuit relation and verification key. There is no UltraHonk or Barretenberg proof in the active signing path.

## Public inputs

The verifier receives exactly four 32-byte field values, in order:

1. key commitment
2. signature commitment
3. first 16 bytes of SHA-256(contract), encoded as a field
4. final 16 bytes of SHA-256(contract), encoded as a field

The contract account supplies the canonical 32-byte SHA-256 digest. The verifier recomputes its two field limbs and rejects any mismatch before verifying the pairing equation.

## Privacy model

The signer key and timestamp are private circuit inputs. The key and any biometric features are not serialized into the transaction. A key commitment is public and serves as a per-contract deduplication identifier.

Biometric feature processing is local application functionality, not an on-chain identity guarantee. Claims about biometric uniqueness, liveness, or extractor entropy require independent review.

## Multisig model

Each signer submits a unique verified proof. The program records the verified key commitment in a `MultiSigMember` PDA and increments the agreement only once per member. It marks the agreement finalized at its configured threshold.

## Operational limits

Devnet deployment is not a production security statement. Before Mainnet, the project requires a production Groth16 ceremony, independent review, full end-to-end and adversarial testing, robust relay abuse controls, monitoring, and release procedures.
