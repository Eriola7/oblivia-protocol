# Deployment runbook

How to ship a new version of the program, relay and signing app together. The three must move as one: the program defines the account addresses, and the relay and app derive the same addresses.

## Current release

Deployed to Devnet on November 5, 2026, at slot `518923390`, together with the matching relay and signing app:

- the v1 `verify_groth16` instruction is removed
- multisig addresses include the agreement's threshold and maximum signers

Agreements created before this release use the old address format, so the current relay and app cannot find them. Signatures already recorded stay valid on-chain.

If you run the [trusted setup ceremony](CEREMONY.md), ship its key in the next release so the program and clients move together.

## Before you start

- Solana CLI and Anchor CLI compatible with `anchor-lang` 1.0.x.
- The program's **upgrade authority** keypair, the wallet in `oblivia-contracts/Anchor.toml` (`~/.config/solana/oblivia-devnet.json`), with enough Devnet SOL for the upgrade.
- The **permanent production domain** for the signing app. See the README section "Passkey domain".
- Access to the relay host and the static host for the signing app.

## 1. Check the release

```bash
git checkout main && git pull
npm run setup:test
npm test
npm --prefix sdk test
npm run test:program
```

All must pass. If the ceremony ran, `zk_groth16/verification_key.json` and `sdk/lib/proving/` must contain its output. `./ceremony/ceremony.sh export` puts them there.

## 2. Build the program and run the VM tests

```bash
cd oblivia-contracts
anchor build
cargo test -p oblivia-contracts --test multisig_proof_gate
```

`anchor build` writes `target/deploy/oblivia_contracts.so` and `target/idl/oblivia_contracts.json`. The VM tests run that binary.

Then compare the generated IDL with the committed one:

```bash
diff <(jq -S . target/idl/oblivia_contracts.json) <(jq -S . ../sdk/lib/idl.json)
```

The only acceptable differences are formatting. If anything else differs, copy the generated IDL to `sdk/lib/idl.json`, run `npm test` and commit it before deploying.

## 3. Upgrade the program

The address stays `HaRpXyybfpYpwxkhfj8CjY8EjGqvRd96Zi33iSCTxvHG`. Only the upgrade authority can do this:

```bash
solana program deploy target/deploy/oblivia_contracts.so \
  --program-id HaRpXyybfpYpwxkhfj8CjY8EjGqvRd96Zi33iSCTxvHG \
  --upgrade-authority ~/.config/solana/oblivia-devnet.json \
  --url devnet
solana program show HaRpXyybfpYpwxkhfj8CjY8EjGqvRd96Zi33iSCTxvHG --url devnet
```

Check that "Last Deployed In Slot" moved forward and that the authority is unchanged.

## 4. Deploy the relay from the same commit

Redeploy `relay/` on its host right after the upgrade. It needs:

- `OBLIVIA_DEVNET_KEY`: the sponsor fee payer, not the upgrade authority.
- `OBLIVIA_ALLOWED_ORIGINS`: the signing app's production origin, for example `https://sign.example.com`.
- Optional: `OBLIVIA_SPONSOR_DAILY_SOL` (default `0.5`) and `OBLIVIA_SPONSOR_MIN_SOL` (default `0.2`), the fee payer's daily spending budget and balance floor. See the [relay API](reference/relay-api.md).

Set the host's health check to `GET /health`, so a relay whose fee payer key is broken is restarted and a failing deploy is not promoted.

## 5. Build and deploy the signing app

The signing app lives at **https://oblivia-solsign.netlify.app**, and passkeys are bound to that address. `netlify.toml` builds it with `OBLIVIA_RP_ID=oblivia-solsign.netlify.app`. With the Netlify site linked to this repository, pushing `main` deploys it. Otherwise, build and upload by hand:

```bash
OBLIVIA_RP_ID=oblivia-solsign.netlify.app npm --prefix browser-client run build
```

Then drag `browser-client/dist/` onto the site's **Deploys** page in Netlify. Keep the site name: renaming it changes every user's signer. The build writes a `_headers` file that Netlify and Cloudflare Pages apply automatically. On any other host, set these response headers yourself:

```
Content-Security-Policy: <the policy from the page's meta tag>; frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=()
Strict-Transport-Security: max-age=31536000
```

Serve it over HTTPS on the permanent domain or one of its subdomains. Never point a production build at a temporary address: every signer created there would be lost when the app moves.

## 6. Verify on Devnet

```bash
OBLIVIA_E2E_KEYPAIR=$HOME/oblivia-test-payer.json node zk_groth16/e2e_multisig_devnet.js
```

The output must end with `"allPassed": true`. Record the run in the README's "Devnet smoke test" section.

Then open the signing app on its real domain:

1. Create a passkey.
2. Sign a short test agreement.
3. Create and co-sign a 2-of-2 agreement from a share link.

## If something goes wrong

- **The upgrade fails:** nothing changed. Fix the cause and retry.
- **The relay or app fails after the upgrade:** redeploy them from the same commit as the program. Earlier builds derive the old multisig addresses and cannot work with the upgraded program.
- **You need to roll back the program:** redeploy the previous release's `.so` with the same command. Only do this together with the previous relay and app.
