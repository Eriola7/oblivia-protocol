# Threat model

Oblivia is an on-chain ZK verification and contract-binding primitive. It proves that the holder of a signer key approved the exact bytes of a contract, without revealing the key. It deliberately does **not** manage keys or identify people.

## What Oblivia protects

| Property | How |
| --- | --- |
| A signature binds to one exact contract | The proof's public inputs include both 128-bit limbs of SHA-256(contract). The program compares them with the registered contract before verifying. A proof for one contract cannot be replayed on another. |
| Only valid proofs are recorded | `verify_groth16_v2` verifies the Groth16 proof on-chain and creates the signature PDA in the same instruction. Nothing is written if verification fails. |
| One key, one signature per contract | Signer-record and multisig-member PDAs are derived from the key commitment, so the same key cannot sign or be counted twice. |
| The signer key stays private | Only Poseidon commitments are public. The signer key and signer secret never leave the device. |
| Past signatures survive key loss | Receipts are immutable on-chain PDAs. Losing a key does not invalidate anything already signed. |

## What Oblivia leaves to other systems

**Key storage, backup and recovery.** The signer secret comes from a standard key store:

- In browsers, Face ID / Touch ID / the device PIN unlocks a passkey. Its WebAuthn PRF output is the signer secret. iCloud Keychain and Google Password Manager sync passkeys, so a new device signed into the same account restores the same signer.
- In Node or server integrations, the caller supplies a secret from their own keychain, KMS or wallet.

Oblivia stores no copy and runs no recovery service. If the key store is lost, that signer is lost; the user creates a new one. The security of a signer is the security of its passkey provider or key store.

**Biometrics.** Biometrics never reach Oblivia. The operating system performs user verification and only releases the PRF output. Earlier prototypes derived keys from facial geometry. That approach was removed: the quantized features had at most about 40 bits of entropy and the same face did not reliably reproduce the same key.

## Explicit non-goals

**Human uniqueness.** Multisig deduplicates **key commitments, not people**. One person who controls several passkeys or secrets can produce several valid signers and, for example, satisfy a 3-of-5 threshold alone. Applications that need one-person-one-vote must restrict eligible signers themselves (an allowlist of known key commitments, an organization's membership system, or a proof-of-personhood layer). Proof-of-personhood integration is a future research item, not a current claim.

**Agreement authorization.** Anyone can register a contract hash and create its multisig settings first. Settings are immutable once created. Clients reject conflicting settings, but they cannot stop someone else from creating them first. Use distinct agreement text for distinct agreements.

**Legal identity and enforceability.** A valid proof shows that a key holder approved the bytes. It does not establish who that person is.

**Linkability across contracts.** A signer key produces the same key commitment on every contract it signs, so those signatures are linkable to each other (not to a person). Users who need unlinkable signatures should use a separate passkey per context.

## Current limitations

- The proving key is a development artifact from a single-party setup. Until the [production ceremony](CEREMONY.md), its creator could forge proofs.
- No independent audit yet ([scope](AUDIT_SCOPE.md)).
- The reference relay is publicly callable with in-memory rate limits only.
- Devnet only.
- WebAuthn PRF support varies by platform and passkey provider. Unsupported providers fail closed with a clear error.
