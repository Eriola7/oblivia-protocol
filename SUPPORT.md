# Getting help

## Documentation

- [README](README.md): overview, status and local setup
- [SDK guide](sdk/README.md): installing and using `@oblivia/sdk`
- [Specification](docs/SPEC.md) and [technical specification](docs/TECHNICAL_SPECIFICATION.md)
- [Architecture](docs/ARCHITECTURE.md) and [threat model](docs/THREAT_MODEL.md)

## Asking a question or reporting a bug

Open a [GitHub issue](https://github.com/Eriola7/oblivia-protocol/issues/new/choose) using the matching template. Check existing issues first.

For security vulnerabilities, follow [SECURITY.md](SECURITY.md) instead. Do not report them publicly.

## Common problems

**`OBLIVIA_DEVNET_KEY must be set`**
Submitting a transaction needs a Devnet fee payer. Set `OBLIVIA_DEVNET_KEY` to a hex-encoded 64-byte Solana secret key, for example with `node --env-file=.env app.js`. The SDK does not read `.env` files itself. Proof generation works without it.

**`PasskeyUnavailableError`**
The browser or passkey provider does not support the WebAuthn PRF extension, or the user cancelled. Use a current browser with a platform passkey provider (iCloud Keychain or Google Password Manager). There is no fallback, by design.

**`signerSecret must be a Uint8Array of at least 32 bytes`**
Pass raw bytes from a passkey, wallet or key store, not a string or a number array.

**`InvalidProof` on submission**
The proof does not match the contract. Common causes:

- the contract text or bytes differ from what was registered (hashing is byte-exact)
- the proving artifacts don't match the deployed verification key

**Tests hang after finishing**
snarkjs keeps a worker pool alive. Call `await globalThis.curve_bn128.terminate()` when your process is done proving, and avoid starting several first proofs concurrently.

## Response times

This is a small, independently maintained project. We aim to respond to issues within a week.
