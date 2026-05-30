# Oblivia Protocol

> Forget who I am. Remember what I signed.

Zero-identity contract signing protocol for Solana. Sign legally binding agreements with full cryptographic provability and zero identity disclosure.

No government ID. No KYC. No centralized server. No fees. Ever.

## What Is Built

| Component | Status | Description |
|-----------|--------|-------------|
| ZK Intent Circuit | Complete | Noir circuit, Pedersen commitment, UltraHonk proof, 2 public outputs, verified |
| Biometric Entropy Client | Complete | Fuzzy extractor, generate/reproduce API, secure sketch, variance testing |
| Browser Client | Complete | TensorFlow + MediaPipe, on-device biometric key derivation |
| Node.js Integration | Complete | Biometric to ZK proof to Anchor program to on-chain verified |
| Anchor Smart Contracts | Deployed | Program ID: HaRpXyybfpYpwxkhfj8CjY8EjGqvRd96Zi33iSCTxvHG - 6 instructions |
| On-chain ZK Verification | Live | ZK commitments stored and verified through Anchor program |
| Multi-sig Support | Complete | Anonymous M-of-N threshold signing - create, submit, finalize on-chain |
| TypeScript Tests | 6/6 passing | Full test suite running against Solana devnet |
| Browser ZK Proof | Building | Real Barretenberg WASM - scoped Milestone 3 |
| Witness Network | Building | Permissionless notarization nodes |
| Reference dApps | Planned | Anonymous signing and DAO governance tools |
| Security Audit | Planned | Independent third-party audit |
| Mainnet Launch | Planned | Full public deployment |

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
- submit_signature: Submit ZK proof commitments
- verify_signature: Verify signature on-chain
- create_multisig: Create M-of-N anonymous multi-sig
- finalize_multisig: Finalize when threshold reached

## Implementation Notes

Browser ZK proof generation is simulated in the browser client. Real Barretenberg proving runs in integration.js. Browser-native proving is scoped for Milestone 3.

Run the real proving pipeline: npm install && node integration.js

## License

MIT - free to use, fork, and build on forever.
