# Security policy

## Status

Oblivia is **Devnet-only and unaudited**. The Groth16 proving key is a development artifact from a single-party setup, pending a [production ceremony](docs/CEREMONY.md). Do not use Oblivia to protect anything of value. See the [threat model](docs/THREAT_MODEL.md) for what is and is not in scope.

## Supported versions

| Component | Supported |
| --- | --- |
| Devnet program `HaRpXyybfpYpwxkhfj8CjY8EjGqvRd96Zi33iSCTxvHG` (v2) | Yes |
| `@oblivia/sdk` latest 0.x release | Yes |
| `main` branch | Yes |
| Earlier SDK versions, the v1 verifier, `archive/*` branches | No |

## Reporting a vulnerability

Please report privately. **Do not open a public issue, pull request or discussion.**

Use GitHub's private vulnerability reporting: [Report a vulnerability](https://github.com/Eriola7/oblivia-protocol/security/advisories/new). You can also find it under the repository's **Security** tab.

Please include:

- the affected component (circuit, program, SDK, relay, browser client) and version or commit
- a description of the issue and its impact
- steps or a proof of concept to reproduce it, using Devnet or a local validator only

## What to expect

- Acknowledgement within 3 business days.
- An initial assessment within 10 business days.
- Updates on progress at least every two weeks until resolved.

## Disclosure

We follow coordinated disclosure. We will:

1. agree a disclosure date with you, normally within 90 days of the report
2. prepare and test a fix
3. redeploy the Devnet program or release the SDK as needed
4. publish a GitHub security advisory crediting you, unless you prefer to remain anonymous

## Scope

In scope:

- the circuit and its use of the proving key
- the Solana program
- `@oblivia/sdk`, including key derivation and passkey handling
- the relay
- the reference browser clients

Out of scope:

- issues in passkey providers, wallets or Solana itself
- the documented non-goals in the threat model (for example, one person controlling several keys)
- denial of service against the public Devnet relay
- findings that require a compromised device

## Safe harbour

We will not pursue legal action against good-faith research that:

- follows this policy
- avoids privacy violations and service disruption
- does not attack accounts or agreements you do not own

There is currently no bug bounty.
