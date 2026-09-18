# Oblivia Protocol Specification (Devnet v2)

## Canonical contract binding

`contract_hash` is SHA-256 over the exact contract bytes provided by the application. It is split into two unsigned 128-bit big-endian values, `contract_hash_lo` and `contract_hash_hi`. These are public Groth16 inputs and must equal the hash stored in the target `Contract` account.

## Proof statement

For private `signer_key` and `timestamp`, the circuit publishes:

1. `key_commitment = Poseidon(signer_key)`
2. `signature_commitment = Poseidon(signer_key, contract_hash_lo, contract_hash_hi, timestamp)`
3. `contract_hash_lo`
4. `contract_hash_hi`

The on-chain verifier accepts only a valid proof for these four values. It then derives the signature PDA from the contract, key commitment, and signature commitment, and derives the signer-record PDA from the contract hash and key commitment. PDA creation enforces per-contract deduplication.

## Single-signature flow

1. Register the canonical SHA-256 contract hash.
2. Generate a Groth16 proof locally.
3. Call `verify_groth16_v2` with the serialized proof, four public inputs, key commitment, and signature commitment.
4. The program verifies and records the attestation atomically.

## Multisig flow

1. Create an M-of-N agreement for a registered contract.
2. Generate and verify each co-signer's v2 proof in the same transaction as `record_verified_multisig`.
3. The member PDA prevents duplicate key commitments. The agreement finalizes when its threshold is reached.

## Security and deployment status

The verification key in this repository is development material, not a production ceremony output. The protocol is deployed on Devnet for integration testing. It is not audited or Mainnet-ready.
