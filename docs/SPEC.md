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

1. Create an M-of-N agreement for a registered contract. Its address is derived from the contract hash, M and N, so the settings cannot be pre-empted or changed.
2. Generate and verify each co-signer's v2 proof in the same transaction as `record_verified_multisig`.
3. The member PDA prevents duplicate key commitments. The agreement finalizes when its threshold is reached.

Deduplication is per key commitment, not per person. One person who controls several signer secrets can be counted several times. Eligibility of participants is the integrating application's responsibility.

## Signer keys

Oblivia does not manage keys. `signer_key` is derived from the contract hash and a caller-supplied secret of at least 32 bytes:

```text
signer_key = first 31 bytes of SHA-256("oblivia/signer-key/v2" || 0x00 || contract_hash || secret)   (248 bits, < BN254 r)
```

The key is per contract. The same secret on the same contract always gives the same key, so the signer-record and member PDAs still reject duplicates. Different contracts give unrelated key commitments, so a signer's signatures on different contracts cannot be linked.

In browsers the secret is the WebAuthn PRF output of a user-verified passkey, evaluated with salt `SHA-256("oblivia/passkey-prf/v1")`. Synced passkeys give the same secret on every device of the same account.

## Security and deployment status

The verification key in this repository is development material, not a production ceremony output. The protocol is deployed on Devnet for integration testing. It is not audited or Mainnet-ready.
