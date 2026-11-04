## What and why

<!-- What does this change, and why is it needed? -->

Closes #

## Components touched

- [ ] Circuit (`zk_groth16/`) — requires a new trusted setup
- [ ] Program (`oblivia-contracts/`) — requires a redeploy; IDL updated in `sdk/lib/idl.json`
- [ ] SDK (`sdk/`) — changelog updated; breaking changes marked
- [ ] Relay / browser clients
- [ ] Docs only

## Testing

<!-- What did you run? Paste relevant output. -->

- [ ] `npm test`
- [ ] `npm --prefix sdk test`
- [ ] `npm run build:browser`
- [ ] `npm run test:program` (always for program changes) and `npm run test:multisig` (needs a Solana build)
- [ ] New or updated tests cover this change

## Checklist

- [ ] README, specifications and threat model still accurate
- [ ] No claim is made that a test or on-chain record does not support
- [ ] No secrets, keypairs or `.env` files committed
