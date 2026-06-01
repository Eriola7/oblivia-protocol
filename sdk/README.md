# Oblivia SDK

Zero-identity contract signing for Solana. MIT licensed. Free forever.

## Install

npm install @oblivia/sdk

## Quick Start

const oblivia = require('@oblivia/sdk');

// Sign a contract with biometric features
const result = await oblivia.signContract(biometricFeatures, contractData);
// { verified: true, identityRevealed: false, dataTransmitted: false }

// Create a 2-of-3 multi-sig contract
await oblivia.createMultiSigContract(contractData, 2, 3);

// Each signer signs independently
await oblivia.signMultiSig(signer1Features, contractData);
await oblivia.signMultiSig(signer2Features, contractData);

// Finalize when threshold reached
await oblivia.finalizeMultiSigContract(contractData);

## API

- deriveKey(biometricFeatures) - Derive signing key from biometrics
- generateProof(biometricFeatures, contractData) - Generate ZK proof
- signContract(biometricFeatures, contractData) - Full signing pipeline
- createMultiSigContract(contractData, threshold, maxSigners) - Create M-of-N multi-sig
- signMultiSig(biometricFeatures, contractData) - Sign as one of N signers
- finalizeMultiSigContract(contractData) - Finalize when threshold met

## Zero Identity Guarantee

- Biometric data: never transmitted, never stored
- Signer identity: never revealed
- Proof: cryptographically verifiable on Solana
- Cost: free forever
