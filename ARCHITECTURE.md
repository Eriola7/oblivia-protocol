# Oblivia Protocol — Technical Architecture

> *Forget who I am. Remember what I signed.*

## Overview

Oblivia is a zero-identity contract signing protocol built on Solana. It enables any party — human, DAO, or autonomous agent — to sign legally binding agreements with full cryptographic provability and zero identity disclosure.

This document describes the technical architecture of what has been built and what is planned.

---

## What Is Built

### 1. ZK Intent Circuit (`/zk_intent_circuit`)

Built in Noir using the UltraHonk proving system.

The circuit takes three private inputs:
- `contract_hash` — 32-byte hash of the agreement being signed
- `signer_key` — cryptographic key derived from biometric entropy
- `timestamp` — signing time

It produces a zero-knowledge proof that a unique cryptographic actor committed to a specific contract at a specific time — without revealing the actor's identity.

**Why Noir:** Noir compiles to ACIR (Abstract Circuit Intermediate Representation), which produces proofs verifiable on Solana with minimal compute units. Risc0 was evaluated but Noir's proof size and Solana compatibility made it the clear choice for on-chain verification at scale.

**Why UltraHonk:** UltraHonk is more efficient than Groth16 for circuits of this complexity — smaller proof sizes, faster verification, and no trusted setup requirement.

Proof output: 500 fields, 2 public inputs (key_commitment and signature_commitment), verified in under 1 second.

---

### 2. Biometric Entropy Client (`/biometric-entropy-client`)

A fuzzy extractor implementation that derives a stable cryptographic signing key from biometric input.

**How it works:**
1. Biometric features are captured (face geometry or voice)
2. Features are quantized into discrete buckets
3. Error correction absorbs natural biometric variance
4. SHA-256 hash of corrected features produces a 32-byte signing key

**Why fuzzy extractors:** Standard cryptographic key derivation (PBKDF2, scrypt) requires exact input. Biometric readings are never exactly the same twice. Fuzzy extractors solve this — same biology produces same key despite natural variance.

**Key properties proven:**
- Same biology → same key every time ✅
- Natural variance absorbed (bucket size 64) ✅  
- Different biology → different key ✅
- Zero biometric data transmitted or stored ✅

---

### 3. Browser Client (`/browser-client`)

A browser-based interface using TensorFlow.js and MediaPipe Face Mesh.

**Flow:**
1. Camera access requested
2. TensorFlow loads MediaPipe Face Mesh model
3. 468 facial landmarks detected
4. 20 stable geometric ratios extracted (distances normalized by face width)
5. Fuzzy extractor derives signing key on-device
6. Contract hashed and ZK proof generated
7. Proof verified

All processing happens on the user's device. Nothing is transmitted. Nothing is stored.

---

### 4. Anchor Smart Contract Program (`/oblivia-contracts`)

Deployed on Solana devnet. Program ID: HaRpXyybfpYpwxkhfj8CjY8EjGqvRd96Zi33iSCTxvHG

Seven on-chain instructions:
- initialize: Creates global ContractRegistry PDA
- register_contract: Stores contract hash on-chain with timestamp
- submit_signature: Stores ZK proof commitments (key_commitment, signature_commitment) on-chain
- verify_signature: Verifies signature is valid and linked to contract
- create_multisig: Creates anonymous M-of-N threshold signing contract
- submit_multisig_signature: Submits ZK commitments to multisig — PDA deduplication prevents duplicate signatures
- finalize_multisig: Finalizes when signature threshold is reached

Anonymous multi-sig enables any threshold of parties to co-sign a contract with full cryptographic proof of consent and zero identity disclosure.

### 5. Integration Layer (`/integration.js`)

Full end-to-end pipeline:
1. Biometric features captured
2. Fuzzy extractor derives signing key
3. Noir ZK circuit generates UltraHonk proof
4. Proof verified locally
5. Contract registered on Anchor program on-chain
6. ZK commitments submitted to Anchor program
7. Signature verified through Anchor program on-chain

Output: Contract signed: true. Identity revealed: false. Data transmitted: false. On-chain verified: true.

---

## What Is Being Built

### 5. Smart Legal Object Layer — SLOL (`/slol`) — Milestone 2 (In Progress)
Open standard for representing legal agreements as on-chain objects. Supports NDAs, contributor agreements, DAO governance decisions, whistleblower agreements, inheritance. Built on Anchor.

### 7. Anchor SDK + Full Testnet MVP — Milestone 3
On-chain ZK proof verifier, time-locks, revocation conditions. Full developer SDK. Public testnet deployment. (Anchor program deployed — SDK packaging in progress)

### 8. Validator Witness Network — Milestone 4
Lightweight Solana validator extension for timestamping and notarizing contract signatures. Permissionless node operation.

### 9. Reference dApps — Milestone 5
- Anonymous Document Signing tool
- DAO Anonymous Governance Agreement tool

### 10. Security Audit + Mainnet — Milestone 6
Independent third-party audit of ZK circuits, biometric client, and smart contracts. Full mainnet deployment.

---

## Technical Stack

| Component | Technology | Reason |
|-----------|-----------|--------|
| ZK Circuits | Noir + UltraHonk | Solana-compatible, no trusted setup |
| Biometric | TensorFlow.js + MediaPipe | On-device, no server required |
| Key Derivation | Fuzzy Extractors + SHA-256 | Variance-tolerant, cryptographically secure |
| Smart Contracts | Anchor (Solana) | Production-grade Solana framework |
| Storage | IPFS + Arweave | Permanent, censorship-resistant |
| Frontend | Webpack + Vanilla JS | Minimal dependencies, maximum compatibility |

---

## Repository Structure
---

## Security Properties

- **Zero knowledge** — proof reveals nothing about the signer's identity
- **Non-repudiation** — proof can only be produced by the holder of the biometric key
- **On-device processing** — biometric data never leaves the user's device
- **Permanent record** — contracts stored on IPFS/Arweave, notarized on Solana
- **Open source** — every component MIT licensed, auditable by anyone

---

*Built on Solana. Free forever. For everyone.*
