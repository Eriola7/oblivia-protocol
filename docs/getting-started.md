# Getting started

This guide takes you from nothing to a proof generated on your machine, then to a signature verified on Devnet.

## Requirements

- Node.js 22.14 or newer
- For on-chain signing only: a Solana keypair with Devnet SOL

## Install the SDK

`@oblivia/sdk` is not yet published to npm. Until it is, build the package from the repository:

```bash
git clone https://github.com/Eriola7/oblivia-protocol.git
cd oblivia-protocol/sdk && npm ci && npm pack
# then, in your project:
npm install /path/to/oblivia-protocol/sdk/oblivia-sdk-0.1.0.tgz
```

Once published, this becomes `npm install @oblivia/sdk`.

## Generate a proof offline

No wallet or network is needed. This example runs in CI on every change:

```js
--8<-- "tools/docs/examples/offline-proof.js"
```

The proof binds a key commitment to the contract hash. The signer secret and signing key never leave the machine.

## Sign on Devnet

Put a fee payer in `.env` as `OBLIVIA_DEVNET_KEY` (a hex-encoded 64-byte Solana secret key with Devnet SOL). The SDK does not read `.env` itself, so pass it to Node:

```js
--8<-- "tools/docs/examples/sign-devnet.js"
```

```bash
node --env-file=.env sign-devnet.js
```

`signContract` registers the contract if needed, then verifies the proof on-chain and records the signature in one transaction.

## Multisig agreements

An agreement's threshold and maximum signers are part of its on-chain address, so always pass them:

```js
--8<-- "tools/docs/examples/multisig-devnet.js"
```

Each key counts once. One person holding several keys counts several times, so restrict who may sign in your application.

## In the browser with passkeys

```js
--8<-- "tools/docs/examples/browser-passkey.js"
```

### Passkeys and domains

A passkey belongs to one domain (its relying-party ID). Pick your **permanent production domain before creating real signers**. Signers created anywhere else are lost when the app moves; past signatures stay valid, but users get new identities.

Use the registrable domain (`example.com`) as `rpId`, so the app can move between its subdomains without changing anyone's signer. The reference clients refuse to create passkeys unless a production build names this domain. See [Deployment](DEPLOYMENT.md#5-build-and-deploy-the-signing-app).

Passkey providers without WebAuthn PRF support fail with `PasskeyUnavailableError`.

## Run the project locally

```bash
npm run setup:test
npm test                 # offline: no wallet, no transactions
npm --prefix sdk test
npm run test:program     # Rust: proof-verification tests
```

## Next steps

- [SDK API reference](reference/sdk/index.md)
- [Program instructions](reference/program.md)
- [Relay API](reference/relay-api.md), for browser apps that should not hold a fee payer
- [Threat model](THREAT_MODEL.md)
