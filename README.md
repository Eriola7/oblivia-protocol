# Oblivia Protocol

> **Security status:** signing and multisig submission are intentionally disabled in the hardened program until the contract-bound Groth16 verifying key is integrated and a replacement program is deployed. This repository is not ready for production use.

## Current proof migration

`zk_groth16/oblivia.circom` now exposes the two 128-bit limbs of the canonical SHA-256 contract hash as public inputs. A proof therefore binds its key and signature commitments to the complete contract hash. The regenerated development verification key has four public signals; it must be integrated into a newly deployed Anchor program before signing is re-enabled. The current devnet program and the retired on-chain demo target the previous two-signal circuit and must not be used for new attestations.

> Forget who I am. Remember what I signed.

Zero-identity contract signing protocol for Solana. Sign legally binding agreements with full cryptographic provability and zero identity disclosure.

No government ID. No KYC. No centralized server. No fees. Ever.

## What Is Built

| Component | Status | Description |
|-----------|--------|-------------|
| ZK Intent Circuit | ✅ Complete | Noir circuit, Pedersen commitment, UltraHonk proof, 2 public outputs, verified |
| Biometric Entropy Client | ✅ Complete | Fuzzy extractor, generate/reproduce API, secure sketch, variance testing |
| Browser Client | ✅ Complete | TensorFlow + MediaPipe, on-device biometric key derivation |
| Node.js Integration | ✅ Complete | Biometric to ZK proof to Anchor program to on-chain verified |
| Anchor Smart Contracts | ✅ Deployed | Program ID: HaRpXyybfpYpwxkhfj8CjY8EjGqvRd96Zi33iSCTxvHG - 8 instructions |
| On-chain ZK Proof Verification | ✅ Live | Groth16 proof verified on Solana devnet via alt_bn128 pairing syscalls — 93,609 CU |
| Groth16 Circuit | ✅ Complete | Circom circuit, trusted setup, 482 constraints, 2 public outputs |
| Multi-sig Support | ✅ Complete | Anonymous M-of-N threshold signing — create, submit, finalize on-chain |
| SLOL v1 Schema | 🔨 In Progress | Schema design started — NDA, DAO governance, whistleblower, inheritance, ZeroIDDeal. Full standard and jurisdictional compliance documentation in development |
| TypeScript Tests | ✅ 6/6 passing | Full test suite running against Solana devnet |
| Browser ZK Proof | ✅ Complete | Real Barretenberg WASM proving on-device — SDK integration scoped Milestone 3 |
| Witness Network | 🔨 Building | Permissionless notarization nodes |
| Reference dApps | 📅 Planned | Anonymous signing and DAO governance tools |
| Security Audit | 📅 Planned | Independent third-party audit |
| Mainnet Launch | 📅 Planned | Full public deployment |

## Live On-Chain

Anchor Program: HaRpXyybfpYpwxkhfj8CjY8EjGqvRd96Zi33iSCTxvHG
Explorer: https://explorer.solana.com/address/HaRpXyybfpYpwxkhfj8CjY8EjGqvRd96Zi33iSCTxvHG?cluster=devnet

Latest verified signature transaction:
https://explorer.solana.com/tx/okwMA55ouBCb8KTaFU5Z4WLhsa3zpUFf7k5TTyy2yMeRK6HcmmiuvCBuCgg4JugyEAaooUWUYqkXio9SGhPaQ9p?cluster=devnet

## Quick Start

ZK Circuit:
  cd zk_intent_circuit && nargo test && nargo compile && nargo execute

Biometric Client:
  cd biometric-entropy-client && npm install && node test.js

Full Pipeline:
  npm install && node integration.js

Anchor Tests:
  cd oblivia-contracts && anchor test --skip-local-validator

## Anchor Program Instructions

- initialize: Create global contract registry
- register_contract: Store contract hash on-chain
- submit_signature: Submit ZK proof commitments with SignerRecord PDA deduplication
- verify_signature: Verify signature on-chain
- create_multisig: Create M-of-N anonymous multi-sig
- submit_multisig_signature: Submit ZK commitment to multisig with MultiSigMember deduplication
- finalize_multisig: Finalize when threshold reached
- verify_groth16: Verify Groth16 ZK proof on-chain via alt_bn128 syscalls

## Implementation Notes

Browser ZK proof generation runs via real Barretenberg WASM in the browser client. Full Anchor SDK integration for browser-native proving is scoped for Milestone 3.

Run the real proving pipeline: npm install && node integration.js

## License

MIT - free to use, fork, and build on forever.

## Groth16 On-Chain Verification

Real ZK proof verified on Solana devnet using alt_bn128 pairing syscalls:

**Transaction:** `3wsxfRkPJhR4L5j1yAnezvMQaY1sAYry2nFqa3JyNS8G2ZzjaH6DoXUzYcQr4PgeC2Jx1V99UMworsC7iyLmfVET`

**Explorer:** https://explorer.solana.com/tx/3wsxfRkPJhR4L5j1yAnezvMQaY1sAYry2nFqa3JyNS8G2ZzjaH6DoXUzYcQr4PgeC2Jx1V99UMworsC7iyLmfVET?cluster=devnet

- Program: ObliviaContracts — `HaRpXyybfpYpwxkhfj8CjY8EjGqvRd96Zi33iSCTxvHG`
- Instruction: VerifyGroth16
- Compute units: 93,609
- Result: Success — Finalized
- Identity revealed: false
