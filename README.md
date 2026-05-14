# Oblivia Protocol

> *Forget who I am. Remember what I signed.*

Zero-identity contract signing protocol for Solana. Sign legally binding agreements with full cryptographic provability and zero identity disclosure.

## What It Does

Oblivia enables any party — human, DAO, or autonomous agent — to sign contracts using:
- **Zero-knowledge proofs** — proves you signed without revealing who you are
- **Biometric entropy** — your face or voice derives a signing key, entirely on-device
- **On-chain notarization** — permanent, tamper-proof record on Solana

No government ID. No KYC. No centralized server. No fees. Ever.

## What Is Built

| Component | Status | Description |
|-----------|--------|-------------|
| ZK Intent Circuit | ✅ Complete | Noir circuit, Pedersen hash commitment, UltraHonk proof, 33 public inputs, verified |
| Biometric Entropy Client | ✅ Complete | Fuzzy extractor with secure sketch, Dodis et al. construction, realistic variance testing |
| Browser Client | ✅ Complete | TensorFlow face detection, on-device biometric key derivation |
| Integration | ✅ Complete | Full end-to-end pipeline — biometric to fuzzy extractor to ZK proof to Solana devnet |
| Solana Devnet | ✅ Complete | Proof hash anchored on-chain via Memo program, 5 live transactions |
| Anchor Smart Contracts | 🔨 Building | On-chain contract storage, multi-sig |
| Witness Network | 🔨 Building | Permissionless notarization nodes |
| Reference dApps | 🔨 Building | Anonymous signing + DAO governance tools |
| Security Audit | 📅 Planned | Independent third-party audit |
| Mainnet Launch | 📅 Planned | Full public deployment |

## Quick Start

### ZK Circuit
```bash
cd zk_intent_circuit
nargo test
nargo compile
nargo execute
```

### Biometric Entropy Client
```bash
cd biometric-entropy-client
npm install
node test.js
```

### Full Integration
```bash
npm install
node integration.js
```

### Browser Client
```bash
cd browser-client
npm install
npm start
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for full technical documentation.

## License

MIT — free to use, fork, and build on forever.

## Live Devnet Transaction

Oblivia ZK proof anchored on Solana devnet:

**Transaction:** `8gFnhz4PHqZN4GCPRvr3EE6wkfQgPU5ERsRhdMdAZq78YyenTmMicSnQdNV2cMh2yBD5g8YesPTwuSVXWNJ27Vy`

**Explorer:** https://explorer.solana.com/tx/8gFnhz4PHqZN4GCPRvr3EE6wkfQgPU5ERsRhdMdAZq78YyenTmMicSnQdNV2cMh2yBD5g8YesPTwuSVXWNJ27Vy?cluster=devnet

Proof hash anchored on-chain via Solana Memo Program. Finalized. Permanently verifiable.

## Environment Setup

Copy `.env.example` to `.env` and set your Solana devnet keypair:

```bash
cp .env.example .env
```

Generate a funded devnet keypair:
1. Run: `node -e "const {Keypair} = require('@solana/web3.js'); console.log(Buffer.from(Keypair.generate().secretKey).toString('hex'));"`
2. Fund it at: https://faucet.solana.com
3. Add the hex key to your `.env` file

## Implementation Notes

**Browser Client Proof Generation**
The browser client demonstrates the full signing UX including real biometric capture via TensorFlow MediaPipe and on-device key derivation. The ZK proof generation step in the browser uses a simulated flow — the actual Barretenberg proving pipeline runs in the Node.js integration layer (`integration.js`). Browser-native ZK proof generation is scoped for Milestone 3, where the full Anchor SDK and on-chain verifier will be built.

To run the real end-to-end proving pipeline:
```bash
npm install
node integration.js
```
