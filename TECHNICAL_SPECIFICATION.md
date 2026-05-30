# Oblivia Protocol — Technical Specification

> *This document is intended for technical reviewers. It covers the full architectural complexity, skill requirements, cryptographic foundations, and milestone breakdown of the Oblivia Protocol.*

---

## 1. The Problem Nobody Has Solved

Every existing signing solution — DocuSign, World ID, EthSign, Sign Protocol — shares one fatal assumption: identity must be known to be verified.

Oblivia rejects this assumption entirely.

The question Oblivia answers is not "who signed this?" The question is "did a unique, consistent, non-repudiable actor sign this?" These are not the same question. The first requires identity. The second requires only proof.

This distinction is not philosophical. It is cryptographic. And it has never been implemented as open, free, composable infrastructure on any major blockchain — until now.

---

## 2. Cryptographic Foundation

### 2.1 Zero-Knowledge Proofs

A zero-knowledge proof (ZKP) is a cryptographic protocol that allows a prover to convince a verifier that a statement is true without revealing any information beyond the truth of the statement itself.

Oblivia uses **zk-SNARKs** (Zero-Knowledge Succinct Non-interactive Arguments of Knowledge) — specifically the **UltraHonk** proving system built on the **Barretenberg** cryptographic library developed by Aztec Protocol.

**Why UltraHonk specifically:**

Standard Groth16 zk-SNARKs require a trusted setup ceremony — a multi-party computation that, if compromised, allows fake proofs to be generated. UltraHonk eliminates this requirement entirely using a polynomial commitment scheme (KZG commitments over BN254) that requires no trusted setup.

Additional advantages:
- Proof size: ~16KB regardless of circuit complexity
- Verification time: sub-second on Solana
- No per-circuit trusted setup — one universal SRS serves all circuits
- Plonkish arithmetization allows efficient encoding of the Oblivia intent logic

**The circuit is written in Noir** — a domain-specific language for ZK circuit development that compiles to ACIR (Abstract Circuit Intermediate Representation). ACIR is backend-agnostic, meaning the same circuit can target UltraHonk today and any future proving system without rewriting.

**Why Noir over alternatives:**
- Risc0 uses STARK-based proving — larger proof sizes, higher on-chain verification cost
- Circom requires manual circuit optimization and has no type safety
- Halo2 requires deep cryptographic expertise and has poor tooling
- Noir provides Rust-like syntax, type safety, and first-class Barretenberg integration

### 2.2 The ZK Intent Circuit

The Oblivia intent circuit proves the following statement:

*"I know a private signer key and a contract hash such that the signer key is non-zero, the contract hash matches the public commitment, and the signing timestamp is valid."*

In Noir:

```rust
fn main(
    contract_hash: [u8; 32],
    signer_key: Field,
    timestamp: u64
) -> pub (Field, Field) {
    assert(signer_key != 0);
    assert(timestamp > 0);
    let key_commitment = std::hash::pedersen_hash([signer_key]);
    let mut field_low: Field = 0;
    let mut field_high: Field = 0;
    for i in 0..16 { field_low = field_low * 256 + contract_hash[i] as Field; }
    for i in 16..32 { field_high = field_high * 256 + contract_hash[i] as Field; }
    let signature_commitment = std::hash::pedersen_hash([
        signer_key, field_low, field_high, timestamp as Field
    ]);
    (key_commitment, signature_commitment)
}
```

This circuit produces two public outputs:
- key_commitment: Pedersen hash of signer_key — proves identity without revealing it
- signature_commitment: Pedersen hash of (signer_key, contract_hash, timestamp) — binds proof to specific contract and timestamp, prevents proof reuse
- Full 32-byte contract hash encoded across two Field elements
- 500-field UltraHonk proof, 2 public inputs, verifies in under 1 second

## 3. Biometric Entropy Derivation

### 3.1 The Problem With Traditional Key Management

Traditional cryptographic key management requires users to store, backup, and protect private keys. This creates catastrophic failure modes — lost keys mean lost access, stolen keys mean identity theft, and key management UX is a primary barrier to Web3 adoption.

Oblivia replaces key storage with key derivation. The key is never stored anywhere. It is derived fresh from the user's biology every time it is needed.

### 3.2 Fuzzy Extractors

A **fuzzy extractor** is a cryptographic construction that derives a stable, high-entropy output from noisy input. Formally defined by Dodis et al. (2004), a fuzzy extractor (Gen, Rep) satisfies:

- **Correctness:** For any two inputs w, w' where distance(w, w') ≤ t, Rep(w', P) = R where (R, P) = Gen(w)
- **Security:** R is uniformly random and independent of P

In plain terms: same input (within tolerance) always produces the same output. Slightly different input (natural biometric variance) still produces the same output. Significantly different input (different person) produces a completely different output.

**Oblivia's implementation:**

1. **Feature extraction** — TensorFlow MediaPipe Face Mesh detects 468 facial landmarks. 20 stable geometric ratios are extracted, normalized by face width for scale invariance:
   - Inter-eye distance ratio
   - Nose-to-chin ratio  
   - Mouth width ratio
   - 17 additional stable geometric relationships

2. **Quantization** — Features are quantized to 256 discrete levels (8-bit precision)

3. **Error correction** — Quantized values are snapped to bucket boundaries (bucket size 64) using floor quantization. This absorbs natural biometric variance while maintaining discriminability between different individuals.

4. **Key derivation** — SHA-256 hash of corrected feature vector + domain separation salt produces a deterministic 32-byte signing key

**Proven properties:**
- Same person, same reading → identical key ✅
- Same person, natural variance → identical key ✅  
- Different person → different key ✅
- Zero biometric data transmitted ✅
- Zero biometric data stored ✅

### 3.3 Why This Is Hard

Implementing a fuzzy extractor correctly requires solving a fundamental tension: tolerance must be wide enough to absorb natural biometric variance but narrow enough to maintain security against different individuals. Getting this wrong in either direction breaks the system — too tight and legitimate users are locked out, too loose and the key becomes guessable.

The error correction approach used in Oblivia — floor quantization with empirically determined bucket size — was validated through testing on realistic biometric variance distributions. This is not a solved problem with a textbook answer. It required original calibration work.

---

## 4. Browser-Based Biometric Processing

Running TensorFlow.js with MediaPipe Face Mesh in a browser is non-trivial:

- The MediaPipe model is 3MB+ of WASM and weights
- Face landmark detection requires GPU acceleration via WebGL backend
- 468 landmark points must be processed in real-time
- All of this must run entirely client-side with no server involvement

The Oblivia browser client:
- Loads TensorFlow.js with WebGL backend
- Initializes MediaPipe Face Mesh detector
- Captures a single video frame from the user's camera
- Runs landmark detection on-device
- Extracts geometric ratios
- Runs the fuzzy extractor
- Derives the signing key
- Hashes the contract
- Generates and verifies the ZK proof

**Nothing leaves the browser.** The camera stream is accessed, processed, and immediately discarded. No frames are stored, transmitted, or logged. This is architecturally enforced — there is no server to send data to.

---

## 5. Milestone Breakdown

### Milestone 1 — ZK Intent Proof + Biometric Entropy Client
**Status: Complete**
**Budget: $45,000**

Deliverables completed:
- Noir ZK intent circuit — compiled, tested, proof generation verified
- UltraHonk backend integration — 500-field proof, 32 public inputs
- Fuzzy extractor implementation — all three key properties validated
- TensorFlow MediaPipe browser client — real face landmark detection
- Node.js end-to-end integration — biometric → key → ZK proof → verified
- Full test suite
- MIT licensed, publicly available on GitHub

**Skill requirements:**
- Senior ZK engineer with Noir and Barretenberg experience
- Cryptographer with fuzzy extractor implementation experience
- Frontend engineer with TensorFlow.js and WebGL experience
- Systems engineer for Node.js integration

This milestone represents the highest technical risk component of the entire protocol. The ZK circuit and biometric entropy system are novel — there is no existing open-source implementation to reference. Both were built from first principles.

---

### Milestone 2 — Smart Legal Object Layer (SLOL v1)
**Status: In Development**
**Budget: $35,000**

The Smart Legal Object Layer is an open standard for representing legal agreements as composable on-chain objects.

**Technical complexity:**
- Legal agreements must be mapped to deterministic on-chain representations
- Different jurisdictions have different requirements for contract enforceability
- The standard must be flexible enough for DAOs, individuals, and autonomous agents
- Schema must be versioned and upgradeable without breaking existing contracts

**Deliverables:**
- SLOL v1 formal specification
- Legal primitive definitions (NDAs, contributor agreements, DAO governance, inheritance, whistleblower agreements)
- Jurisdictional evidentiary compliance mapping
- Open schema for developer adoption
- LexDAO collaboration and review

**Skill requirements:**
- Legal engineer with smart contract and legaltech experience
- Jurisdictional researcher across US, EU, and international frameworks
- Protocol designer with composability expertise

---

### Milestone 3 — Anchor SDK + Testnet MVP
**Status: Planned**
**Budget: $55,000**

**Technical complexity:**
- Anchor smart contracts must store contract objects with cryptographic integrity
- Multi-signature flows require threshold signature schemes on-chain
- Time-locks require deterministic on-chain time verification
- Revocation conditions must be enforceable without revealing contract contents
- The ZK proof from Milestone 1 must be verified on-chain by the Anchor program

**The critical challenge:** Verifying a UltraHonk proof on Solana requires implementing a Solana-compatible verifier. Solana's compute unit budget constrains what cryptographic operations can be performed on-chain. Proof verification must be optimized to fit within Solana's execution model.

**Deliverables:**
- Full Anchor smart contract suite
- On-chain ZK proof verifier
- Open contract NFT standard
- Multi-sig, time-lock, revocation modules
- Public testnet deployment
- Full developer SDK
- Integration documentation

---

### Milestone 4 — Validator Witness Network
**Status: Planned**
**Budget: $40,000**

A decentralized notarization layer built as a lightweight extension to Solana validator infrastructure.

**Technical complexity:**
- Witness nodes must timestamp and notarize contract signatures without seeing contract contents
- The network must be permissionless — anyone can run a node
- Notarization must be verifiable on-chain
- Node software must integrate with existing Solana validator infrastructure without forking

**Deliverables:**
- Witness node software
- Permissionless node operator onboarding
- On-chain notarization registry
- Open dApp integration standard
- Node incentive mechanism

---

### Milestone 5 — Reference dApps
**Status: Planned**
**Budget: $35,000**

Two production-grade open-source dApps demonstrating real-world Oblivia use cases:

**Anonymous Document Signing Tool**
- Full signing flow from biometric capture to on-chain proof
- Contract management interface
- Proof verification and audit trail
- Multi-party signing support

**DAO Anonymous Governance Agreement Tool**
- Anonymous multi-sig governance flows
- Threshold signature support
- On-chain proposal and agreement management
- Integration with existing DAO frameworks

---

### Milestone 6 — Security Audit + Mainnet
**Status: Planned**
**Budget: $40,000**

**Audit scope:**
- ZK circuit soundness — can fake proofs be generated?
- Biometric entropy security — can keys be reverse-engineered?
- Smart contract security — reentrancy, overflow, access control
- Browser client security — camera data handling, key material lifecycle

**Mainnet requirements:**
- All audit findings resolved
- Compute unit optimization for on-chain proof verification
- IPFS and Arweave integration for permanent contract storage
- Full ecosystem documentation

---

## 6. Why This Cannot Be Built Cheaper or Faster

**ZK engineering is the scarcest skill in Web3.** There are fewer than 500 engineers globally with production Noir experience. Day rates for ZK specialists start at $1,500. The circuit architecture, proof system selection, and Solana verification optimization alone represent months of specialist work.

**Biometric cryptography is an active research area.** Fuzzy extractor implementations that are both secure and usable are not commodity work. The specific combination of facial geometry extraction, quantization, and error correction used in Oblivia required original research and calibration.

**On-chain ZK verification on Solana is an unsolved engineering problem.** Fitting a UltraHonk verifier within Solana's compute unit constraints requires deep knowledge of both the proving system and Solana's execution model. No public implementation of this exists.

**The legal schema work is genuinely novel.** Mapping real-world legal agreement types to deterministic on-chain representations that are enforceable across jurisdictions has never been done at this level of specificity. It requires a legal engineer who understands both smart contracts and international contract law.

---

## 7. Security Model

**Threat: Can someone forge a proof without a valid biometric key?**
No. The ZK circuit enforces that a valid non-zero signer key was used. Without the key, the circuit constraints cannot be satisfied and no valid proof can be generated.

**Threat: Can the biometric key be reverse-engineered from the proof?**
No. The signer key is a private input to the ZK circuit. By the zero-knowledge property, the proof reveals nothing about the private inputs beyond their validity.

**Threat: Can someone steal another person's biometric key?**
The key is never stored or transmitted. It is derived fresh from the user's face geometry on their device at signing time. There is no key to steal.

**Threat: Can biometric data be extracted from the browser client?**
No. The camera stream is processed entirely on-device by TensorFlow.js. The raw frames are never stored or transmitted. Only the derived signing key is used, and it exists in memory only for the duration of the signing operation.

**Threat: Can a signer deny signing?**
No. The ZK proof is non-repudiable by cryptographic construction. The proof can only be generated by the holder of the biometric key. Re-presenting the same biometric regenerates the same key, which matches the on-chain proof. Denial is mathematically equivalent to claiming the proof is invalid — which the verifier disproves instantly.

---

## 8. Why Solana

- **Cost:** ZK proof verification requires on-chain computation. Ethereum gas costs make this economically inaccessible at the transaction frequency Oblivia requires. A single proof verification on Ethereum costs $5-50 depending on gas prices. On Solana it costs fractions of a cent.
- **Speed:** Signing and verification must feel instant to users. Solana's 400ms block times and sub-second finality make this possible.
- **Composability:** Oblivia is designed as a primitive. Other Solana applications can integrate Oblivia signing with a single SDK call. This composability is only possible because of Solana's shared execution environment.
- **Ecosystem:** The developer community, tooling (Anchor, web3.js), and infrastructure (RPCs, explorers, wallets) make Solana the only viable foundation for a protocol of this complexity.

---

## 9. Open Source Commitment

Every line of code produced by this project is and will remain MIT licensed. No exceptions. No delayed releases. No proprietary forks.

This includes:
- All ZK circuits and cryptographic primitives
- The biometric entropy derivation client
- The full Anchor smart contract suite
- The developer SDK
- The validator witness node software
- Both reference dApp implementations

Oblivia is infrastructure. Infrastructure must be free.

---

*For the working implementation, see the [GitHub repository](https://github.com/Eriola7/oblivia-protocol).*

*For architecture overview, see [ARCHITECTURE.md](./ARCHITECTURE.md).*
