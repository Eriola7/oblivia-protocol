# Oblivia Protocol Specification

**Version 1.0**
**Zero-Identity Contract Signing on Solana**

*Forget who I am. Remember what I signed.*

---

## 1. Overview

Oblivia is a protocol for signing contracts on Solana such that a signature is **provable and non-repudiable** without revealing the signer's identity. A signer proves, in zero knowledge, that they hold a signing key bound to their biometric, and that this key consents to a specific contract — without disclosing the key or any identifying information on-chain.

Oblivia signatures are **pseudonymous, not anonymous**. Anonymous implies untraceable and unverifiable. Pseudonymous means one specific, unique key signed — provably and non-repudiably — without attaching a legal identity to the act.

### 1.1 Trust Model

- **On-device trust:** Biometric capture and key derivation occur entirely on the signer's device. No biometric data is transmitted or stored at any point.
- **On-chain verification:** All proofs are verifiable by anyone against the deployed program. No trusted third party mediates verification.
- **No custody:** The protocol holds no funds, issues no token, and takes no fees.
- **Off-chain documents by design:** Contract documents are referenced on-chain by hash only. Document storage and retrieval (e.g. IPFS/Arweave) are intentionally left to the integrating application — the protocol anchors proof of agreement, not the documents themselves.

### 1.2 Design Goals

1. A signature must be reproducible only by the party who created it.
2. No identifying information may be written on-chain.
3. Any observer must be able to verify a signature's validity and its binding to a specific contract.
4. The same signer must not be able to sign the same contract twice.
5. Multiple parties must be able to co-sign a single contract, each anonymously.

---

## 2. Cryptographic Construction

### 2.1 Biometric Key Derivation

A signing key is derived from biometric input (facial geometry) using a fuzzy-extractor construction based on Dodis et al.

1. **Feature extraction.** Twenty stable geometric ratios are computed from facial landmarks, each normalized by face width to reduce sensitivity to camera distance and scale.
2. **Quantization.** Features are quantized to a fixed integer range.
3. **Error correction.** A coarse-bucketing step absorbs natural biometric variance so the same face yields the same key across captures.
4. **Key derivation.** The corrected feature vector is combined with a domain-separation salt and hashed (SHA-256) to produce a stable signing key.

**Properties:**
- Same face → same key (reproducibility).
- Different faces → different keys (distinctness).
- No biometric data leaves the device.

**Limitation (v1):** The current error-correction layer uses coarse bucketing rather than a full Dodis et al. secure-sketch reconstruction. This provides tolerance to moderate biometric variance but is not yet a formally optimal fuzzy extractor. Full secure-sketch reconstruction is a planned hardening item.

### 2.2 Intent Circuit

The zero-knowledge circuit takes as **private inputs**:
- `contract_hash` — the hash of the contract being signed
- `signer_key` — the biometric-derived signing key
- `timestamp` — the signing time

It produces two **public outputs**:
- **Key commitment** — a Pedersen hash commitment to the signer's key. Proves knowledge of the key without revealing it.
- **Signature commitment** — a commitment binding the key, the contract hash, and the timestamp. Prevents a proof from being reused across different contracts or times.

The circuit proves: *"I know a signing key whose commitment is X, and I bind it to contract Y at time Z"* — without revealing the key.

### 2.3 Two-Layer Proving Architecture

Oblivia uses two proving systems for two distinct roles:

| Layer | System | Role | Rationale |
|-------|--------|------|-----------|
| Off-chain | Noir + UltraHonk | Client-side proof generation | No trusted setup; efficient in-browser proving via WASM |
| On-chain | Circom + Groth16 | On-chain verification | Constant-size proofs verifiable within Solana's compute budget via native `alt_bn128` pairing syscalls |

Both circuits prove the same cryptographic properties. UltraHonk is optimal for generating proofs on the client (including in-browser). Groth16 is currently the only practical path for verifying a ZK proof on-chain within Solana's compute limits. This two-layer split is a deliberate consequence of Solana's execution environment.

A Groth16 proof has been verified on-chain in a single transaction consuming approximately 93,609 compute units.

---

## 3. On-Chain Program

The Oblivia program is an Anchor program deployed on Solana.

**Program ID (devnet):** `HaRpXyybfpYpwxkhfj8CjY8EjGqvRd96Zi33iSCTxvHG`

### 3.1 Accounts

- **ContractRegistry** — a global singleton PDA tracking total contracts and signatures.
- **Contract** — one per registered contract, keyed by contract hash. Stores the hash, timestamp, and signature count.
- **ObliviaSignature** — one per signature, keyed by `[key_commitment, signature_commitment]`. Stores the commitments and binding metadata.
- **SignerRecord** — deduplication PDA for single-signature contracts, keyed by `[contract_hash, key_commitment]`.
- **MultiSigContract** — one per multisig, keyed by contract hash. Stores threshold, max signers, count collected, and finalization state.
- **MultiSigMember** — deduplication PDA for multisig, keyed by `[multisig, key_commitment]`.

### 3.2 Instructions

The program exposes eight instructions:

1. **initialize** — creates the global ContractRegistry.
2. **register_contract** — stores a contract hash on-chain with a timestamp.
3. **submit_signature** — records a single signature (key + signature commitments). Creation of the SignerRecord PDA fails if the same key has already signed this contract, enforcing single-sign deduplication.
4. **verify_signature** — verifies a signature exists and is bound to its contract.
5. **create_multisig** — creates an M-of-N multisig contract for a given contract hash.
6. **submit_multisig_signature** — records a signature against a multisig. Creation of the MultiSigMember PDA fails if the same key has already signed, enforcing per-signer deduplication. Auto-finalizes when the threshold is reached.
7. **finalize_multisig** — explicitly finalizes a multisig once the threshold is met.
8. **verify_groth16** — verifies a Groth16 proof on-chain via `alt_bn128` pairing syscalls.

### 3.3 Deduplication

Deduplication is enforced by PDA account initialization, not application logic. A member/signer PDA is derived deterministically from the signer's key commitment and the contract. Because a Solana account can only be initialized once, a second signature from the same key commitment on the same contract causes the initialization to fail and the transaction to revert.

**Guarantee:** the same *key commitment* cannot sign the same contract twice.

**Limitation:** deduplication is per-key-commitment, not per-human. A determined party who can derive multiple distinct keys (e.g. via deliberately varied biometric captures) could in principle produce multiple distinct signer identities. The protocol guarantees uniqueness of keys, not of the humans behind them.

---

## 4. Signing Flows

### 4.1 Single Signature

1. Signer derives their key from biometric input (on-device).
2. Client generates a ZK proof binding key → contract → timestamp.
3. Proof is verified locally.
4. `register_contract` is called if the contract is not yet registered.
5. `submit_signature` records the commitments; the SignerRecord PDA enforces one signature per key.

**Result:** an on-chain record proving a unique key consented to the contract, with no identity revealed.

### 4.2 Multi-Signature (M-of-N)

1. A creator registers the contract and calls `create_multisig` with a threshold (M) and max signers (N).
2. The creator shares a reference to the contract (e.g. a link carrying the contract text) with co-signers.
3. Each co-signer independently derives their own key, generates a proof, and calls `submit_multisig_signature`.
4. The MultiSigMember PDA enforces one signature per key.
5. When the collected count reaches the threshold M, the contract auto-finalizes.

**Result:** an on-chain agreement co-signed by M distinct keys, none of which reveals an identity. All co-signers share the same contract hash; each contributes a distinct key commitment.

---

## 5. Security Properties

- **Non-repudiation.** A valid signature can only be produced by a party holding the corresponding biometric-derived key. Repudiation would require demonstrating that a different biometric could produce the same key commitment, which is computationally infeasible.
- **Anonymity.** Only commitments are written on-chain. No biometric data, no raw key, and no identifying information is disclosed.
- **Contract binding.** The signature commitment binds a proof to a specific contract hash and timestamp, preventing reuse across contracts or times.
- **Deduplication.** Enforced cryptographically via PDA initialization (see §3.3).
- **On-chain verifiability.** Any observer can verify signatures and Groth16 proofs against the deployed program.

### 5.1 Known Limitations

1. **Fuzzy extractor.** Coarse-bucket error correction rather than full secure-sketch reconstruction (see §2.1).
2. **Per-key deduplication.** Uniqueness is guaranteed per key commitment, not per human (see §3.3).

---

## 6. Data Formats

- **Contract hash:** 32 bytes (SHA-256 of contract content, truncated to 32 bytes).
- **Key commitment:** 32 bytes (Pedersen hash of the signing key).
- **Signature commitment:** 32 bytes (Pedersen commitment binding key, contract, timestamp).
- **Commitments on the wire:** hex-encoded, `0x`-prefixed.

---

## 7. Reference Implementation

The reference implementation is open-source (MIT) and includes:

- The Noir intent circuit and its test suite.
- The Circom/Groth16 circuit, trusted setup, and on-chain verifier.
- The biometric fuzzy-extractor client.
- The Anchor program (eight instructions).
- A browser client performing on-device capture and in-browser proving.
- A developer SDK wrapping the full signing pipeline.
- Reference applications for single-signature and anonymous multi-signature signing.

---

## 8. License

The Oblivia protocol and its reference implementation are released under the MIT License. The protocol is free to use, extend, and build upon without permission, payment, or restriction.

---

*This specification describes Oblivia v1. It documents the protocol as implemented and verified on Solana devnet, including honest disclosure of current limitations and planned hardening items.*
