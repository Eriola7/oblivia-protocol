# Threat model

Oblivia is an on-chain ZK verification and contract-binding primitive. It proves that the holder of a signer key approved the exact bytes of a contract, without revealing the key. It deliberately does **not** manage keys or identify people.

## What Oblivia protects

| Property | How |
| --- | --- |
| A signature binds to one exact contract | The proof's public inputs include both 128-bit limbs of SHA-256(contract). The program compares them with the registered contract before verifying. A proof for one contract cannot be replayed on another. |
| Only valid proofs are recorded | `verify_groth16_v2` verifies the Groth16 proof on-chain and creates the signature PDA in the same instruction. Nothing is written if verification fails. |
| Signatures cannot be linked across contracts | Signer keys are derived from the contract hash and the signer secret, so one signer's key commitments on different contracts are unrelated. |
| Agreement settings cannot be pre-empted | An agreement's threshold and signer count are part of its on-chain address, so a third party cannot create a contract's agreement first with different settings. |
| One key, one signature per contract | Signer-record and multisig-member PDAs are derived from the key commitment, so the same key cannot sign or be counted twice. |
| The signer key stays private | Only Poseidon commitments are public. The signer key and signer secret never leave the device. |
| Past signatures survive key loss | Receipts are immutable on-chain PDAs. Losing a key does not invalidate anything already signed. |

## What Oblivia leaves to other systems

**Key storage, backup and recovery.** The signer secret comes from a standard key store:

- In browsers, Face ID / Touch ID / the device PIN unlocks a passkey. Its WebAuthn PRF output is the signer secret. iCloud Keychain and Google Password Manager sync passkeys, so a new device signed into the same account restores the same signer.
- In Node or server integrations, the caller supplies a secret from their own keychain, KMS or wallet.

Oblivia stores no copy and runs no recovery service. If the key store is lost, that signer is lost; the user creates a new one. The security of a signer is the security of its passkey provider or key store.

**Passkey domain.** A passkey belongs to the domain it was created on. If the signing app moves to a different domain, users cannot reach their existing passkeys and get new signer identities; past signatures stay valid. The reference clients refuse to create or unlock passkeys unless the build names a permanent production domain, and only on that domain or its subdomains.

**Compromised signing site.** Anyone who can run script on the signing domain (a cross-site scripting bug, a compromised dependency or a hijacked host) can request the passkey's signing secret during a genuine Face ID / Touch ID prompt and then sign as that user. This risk applies to every browser-based wallet. The reference clients reduce it:

- Their production builds load only their own bundled script.
- A strict Content Security Policy blocks inline, injected and external scripts, string `eval`, and connections to any origin except the relay. This was verified in a browser, where proving and signing still work under the policy.
- They contain no inline event handlers.

The host must also send the same policy as an HTTP header with `frame-ancestors 'none'` (see [DEPLOYMENT.md](DEPLOYMENT.md)). Pinned, reviewed dependencies remain essential, because the policy cannot stop malicious code inside the app's own bundle.

**Biometrics.** Biometrics never reach Oblivia. The operating system performs user verification and only releases the PRF output. Earlier prototypes derived keys from facial geometry. That approach was removed: the quantized features had at most about 40 bits of entropy and the same face did not reliably reproduce the same key.

## Explicit non-goals

**Human uniqueness.** Multisig deduplicates **key commitments, not people**. One person who controls several passkeys or secrets can produce several valid signers and, for example, satisfy a 3-of-5 threshold alone. Applications that need one-person-one-vote must restrict eligible signers themselves (an allowlist of known key commitments, an organization's membership system, or a proof-of-personhood layer). Proof-of-personhood integration is a future research item, not a current claim.

**Participant eligibility.** Anyone can create an agreement for a contract and anyone with a key can sign it. Because an agreement's threshold and signer count are part of its address, nobody can pre-empt a creator's settings: different settings always give a different agreement. Who is allowed to sign is up to the application.

**Legal identity and enforceability.** A valid proof shows that a key holder approved the bytes. It does not establish who that person is.

**Proving one signer signed two contracts.** Signer keys are derived per contract, so a signer's key commitments on different contracts are unrelated. This makes signatures unlinkable, but it also means the protocol cannot show that the same signer signed contracts A and B. Applications that need that link must build it themselves.

## Current limitations

- The proving key is a development artifact from a single-party setup. Until the [production ceremony](CEREMONY.md), its creator could forge proofs.
- No independent audit yet ([scope](AUDIT_SCOPE.md)).
- The reference relay is publicly callable with in-memory rate limits only.
- Devnet only.
- WebAuthn PRF support varies by platform and passkey provider. Unsupported providers fail closed with a clear error.
