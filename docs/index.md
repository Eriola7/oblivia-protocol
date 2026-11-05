# Oblivia Protocol

Zero-identity contract signing on Solana. A signer proves, with a Groth16 zero-knowledge proof verified on-chain, that they approved the exact bytes of a contract, without revealing who they are.

Oblivia is a **verification and contract-binding primitive**. It does not manage keys: signers bring a passkey (Face ID / Touch ID unlocks it) or a secret from their own wallet or key store, and backup comes from the platform keychain.

<div class="grid cards" markdown>

-   **Getting started**

    Install the SDK, generate a proof offline, then sign on Devnet.

    [:octicons-arrow-right-24: Getting started](getting-started.md)

-   **Reference**

    SDK API and program instructions, generated from the code, plus the relay API.

    [:octicons-arrow-right-24: SDK API](reference/sdk/index.md)

-   **Protocol**

    The circuit, the on-chain checks and how the pieces fit together.

    [:octicons-arrow-right-24: Specification](SPEC.md)

-   **Security**

    What Oblivia protects, what it leaves to other systems, and what is still open.

    [:octicons-arrow-right-24: Threat model](THREAT_MODEL.md)

</div>

## Status

| Item | Status |
| --- | --- |
| Network | Solana Devnet, program `HaRpXyybfpYpwxkhfj8CjY8EjGqvRd96Zi33iSCTxvHG` |
| On-chain proof verification | Live: proofs are verified and recorded atomically |
| Proving key | Development setup; production [trusted setup](CEREMONY.md) scheduled |
| Audit | [Scope](AUDIT_SCOPE.md) defined |
| Key management | Passkeys and wallets; Oblivia stores no keys |
| SDK | `@oblivia/sdk` 0.1.0, not yet on npm |

## How it works

1. **Secret → key.** A passkey or wallet secret and the contract hash derive a per-contract signing key, on the signer's device.
2. **Key → proof.** A Groth16 circuit proves knowledge of the key and binds it to the full SHA-256 of the contract.
3. **Proof → chain.** The program verifies the proof with Solana's BN254 syscalls and records the signature in the same instruction.

Signatures on different contracts cannot be linked to each other, and the same key cannot sign one contract twice. Multisig agreements count distinct keys, not distinct people.
