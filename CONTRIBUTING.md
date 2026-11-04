# Contributing to Oblivia

Thanks for your interest. Oblivia is security-sensitive infrastructure, so changes are reviewed carefully and need tests.

Found a vulnerability? Do **not** open an issue. Follow [SECURITY.md](SECURITY.md).

## Development setup

Requirements:

- Node.js 22.14+
- Rust and the Solana/Anchor toolchains, only if you work on the program in `oblivia-contracts/`

```bash
git clone https://github.com/Eriola7/oblivia-protocol.git
cd oblivia-protocol
npm run setup:test        # installs root, sdk, relay and zk_groth16 dependencies
npm test                  # offline: no wallet, no transactions
```

Other checks:

```bash
npm --prefix sdk test                                  # SDK package tests
npm --prefix browser-client ci && npm run build:browser
npm run test:program                                   # cargo check (Rust)
npm run test:multisig                                  # program VM tests (needs anchor build)
```

Never commit `.env` files or keypairs. Use a dedicated Devnet test payer for anything that sends transactions.

## Repository layout

See the [README](README.md#repository-layout). In short:

- `zk_groth16/` — the circuit
- `oblivia-contracts/` — the program
- `sdk/` — `@oblivia/sdk`
- `browser-client/` — reference clients
- `relay/` — sponsored relay
- `docs/` — threat model, ceremony and audit scope

## Making a change

1. Open an issue first for anything beyond a small fix, so the approach can be agreed.
2. Branch from `main` using a descriptive name: `fix/relay-status-hash`, `feat/sdk-allowlist`, `docs/threat-model`.
3. Keep each pull request to one concern.
4. Add or update tests. Bug fixes need a test that fails without the fix.
5. Update the docs whenever behaviour, security properties or claims change. The README, specifications and threat model must stay accurate. Do not describe something as implemented, verified or secure unless a test or on-chain record shows it.
6. Run the checks above before opening the pull request.

### Changes that need extra care

- **Circuit** (`oblivia.circom`): any change invalidates the proving and verification keys and requires a new trusted setup. Discuss it in an issue first.
- **Program** (`oblivia-contracts/`): changes require a redeploy. Keep the IDL in `sdk/lib/idl.json` in sync.
- **SDK public API**: breaking changes need a changelog entry in `sdk/CHANGELOG.md` and a version bump.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
fix: reject duplicate signer records in the relay
feat(sdk): accept an allowlist of key commitments
docs: clarify multisig deduplication scope
```

Use the imperative mood and explain *why* in the body when it isn't obvious. Mark breaking changes with `!` and a `BREAKING CHANGE:` footer.

## Code style

- Match the surrounding code. `.editorconfig` sets indentation and line endings.
- Comments explain intent and security reasoning, not what the next line does.
- Fail closed: reject malformed input instead of coercing it.

## Pull request review

At least one maintainer review is required. CI must pass. Reviewers check:

- correctness
- tests
- documentation accuracy
- that no new claim is made without evidence

## Code of conduct

Participation is governed by our [Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
