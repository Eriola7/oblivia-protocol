# Relay API

The relay pays Devnet fees on behalf of browser signers, so a signing page never holds a funded key. It only submits proofs the client generated; it never sees a signer secret or signing key. Source: `relay/server.js`.

!!! note "Pending upgrade"
    The multisig endpoints below take `threshold` and `maxSigners`. This matches `main`; the currently deployed relay predates it. See the [deployment runbook](../DEPLOYMENT.md).

## Conventions

- **Bodies:** JSON, at most 16 KB.
- **`contractHash`:** a JSON array of exactly 32 integers (0–255), the SHA-256 of the contract bytes.
- **`keyCommitment`, `signatureCommitment`:** 64 hex characters, optionally prefixed with `0x`.
- **`proofA`, `proofB`, `proofC`, `publicInputs`:** byte arrays of length 64, 128, 64 and 128, in the program's Groth16 format (A negated). The SDK produces exactly these.
- **Errors:** always `{"error": "<message>"}` with a status code:

| Status | Meaning |
| --- | --- |
| `400` | Malformed request. Nothing was submitted. |
| `404` | The agreement does not exist (status only). |
| `409` | An agreement exists with different settings. |
| `429` | Rate limit reached. |
| `502` | Solana RPC or transaction failure. The request may be retried. |
| `503` | The relay's fee payer is not configured (health only). |

**Rate limit:** sponsored endpoints (`POST`) allow 10 requests per client IP per hour.

**CORS:** only the origins in `OBLIVIA_ALLOWED_ORIGINS` may call the relay from a browser.

## `GET /health`

Readiness check. Returns `{"status": "ready"}`, or `503` with `{"status": "signer misconfigured"}`.

## `POST /sign`

Register the contract if needed, then verify the proof on-chain and record the signature in one transaction.

```json
{
  "contractHash": [/* 32 bytes */],
  "keyCommitment": "hex…",
  "signatureCommitment": "hex…",
  "proofA": [/* 64 bytes */],
  "proofB": [/* 128 bytes */],
  "proofC": [/* 64 bytes */],
  "publicInputs": [/* 128 bytes */]
}
```

Response:

```json
{ "transaction": "<signature>", "explorer": "https://explorer.solana.com/tx/<signature>?cluster=devnet" }
```

An invalid proof, a proof for another contract, or a key that already signed this contract fails with `502` and records nothing.

## `POST /multisig/create`

Create an M-of-N agreement. The contract is registered if needed.

```json
{ "contractHash": [/* 32 bytes */], "threshold": 2, "maxSigners": 3 }
```

Requires `1 <= threshold <= maxSigners <= 255`, as integers.

Responses:

```json
{ "transaction": "<signature>", "multisig": "<address>", "explorer": "…" }
```

```json
{ "alreadyExists": true, "multisig": "<address>" }
```

The agreement's address is derived from the contract hash, `threshold` and `maxSigners`. The same contract with other settings is a different agreement.

## `POST /multisig/sign`

Verify a proof and count the signer toward an agreement, atomically.

```json
{
  "contractHash": [/* 32 bytes */],
  "threshold": 2,
  "maxSigners": 3,
  "keyCommitment": "hex…",
  "signatureCommitment": "hex…",
  "proofA": [/* 64 bytes */],
  "proofB": [/* 128 bytes */],
  "proofC": [/* 64 bytes */],
  "publicInputs": [/* 128 bytes */]
}
```

Response:

```json
{ "transaction": "<signature>", "explorer": "…", "collected": 2, "threshold": 2, "finalized": true }
```

If the transaction confirmed but the follow-up state read failed, the response has `"statusUnavailable": true` instead of the counts. The signature is recorded; do not retry it.

## `GET /multisig/status/:hash?threshold=&maxSigners=`

`:hash` is the URL-encoded JSON array of the 32-byte contract hash. `threshold` and `maxSigners` are required decimal query parameters.

```json
{ "collected": 1, "threshold": 2, "maxSigners": 3, "finalized": false }
```

Returns `404` with `{"exists": false}` if no agreement with these settings exists.

## `GET /proving-assets/…`

Static circuit artifacts for browser proving: `oblivia_js/oblivia.wasm` and `oblivia_1.zkey`.
