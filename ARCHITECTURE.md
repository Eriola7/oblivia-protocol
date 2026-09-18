# Oblivia Architecture

## Trust boundary

Oblivia has one proof-acceptance boundary: the deployed Solana Groth16 v2 verifier. A signature is recorded only after that verifier accepts a proof whose public inputs match the target contract account.

```text
local biometric features → local key derivation → Groth16 proof
                                          │
contract bytes → SHA-256 → two public 128-bit limbs
                                          │
                                          ▼
                         verify_groth16_v2 on Solana
                                          │
                     signature PDA / multisig member PDA
```

## Circuit

`zk_groth16/oblivia.circom` has private inputs `signer_key` and `timestamp`. Its four public outputs are the key commitment, signature commitment, and the low/high 128-bit limbs of the SHA-256 contract hash. The signature commitment incorporates the signer key, both hash limbs, and timestamp.

The pair of hash limbs represents all 32 bytes, rather than a truncated field encoding. The verifier rejects a proof unless all four serialized public inputs match the expected values.

## Program

The program ID is `HaRpXyybfpYpwxkhfj8CjY8EjGqvRd96Zi33iSCTxvHG` on Devnet.

- `verify_groth16_v2` verifies the proof, creates the signature and signer-record PDAs, and updates contract/registry state atomically.
- `record_verified_multisig` adds the already verified key commitment to a multisig agreement. The relay/SDK composes it with `verify_groth16_v2` in one transaction, so either both effects occur or neither does.
- Legacy commitment-only methods fail closed and are not valid integration paths.

## Clients

The browser reference applications and Node SDK use `snarkjs` to create Groth16 proofs. The relay serves the corresponding proving artifacts and sponsors transactions subject to configured CORS and basic rate limiting. Production deployments require an authenticated, distributed rate-limit and monitoring design.

## Production boundary

The committed proving key is development-only. A production ceremony, independent review of the circuit/program/biometric pipeline, and Mainnet operations are required before production use.
