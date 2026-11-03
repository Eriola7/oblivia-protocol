/**
 * Signer key derivation.
 *
 * Oblivia does not manage keys. The caller supplies a high-entropy signer
 * secret held by a standard key store: a synced passkey (via the WebAuthn PRF
 * extension, see ./passkey.js) in the browser, or a device seed / wallet
 * secret in Node. Backup and recovery are whatever that key store provides.
 *
 * The secret is mapped to a BN254 scalar with a domain-separated SHA-256 and
 * truncated to 248 bits, which is always below the field modulus, so there is
 * no modular bias and no reduction step.
 *
 * Works in Node and browsers (no Buffer or Node crypto dependency).
 */
const { sha256 } = require('@noble/hashes/sha2.js');

const SIGNER_KEY_DOMAIN = 'oblivia/signer-key/v1';
const MIN_SECRET_BYTES = 32;
const SCALAR_BYTES = 31;
const SECRET_ERROR = 'signerSecret must be a Uint8Array of at least 32 bytes from a passkey, wallet or device seed';

function toSecretBytes(secret) {
    const isByteView = ArrayBuffer.isView(secret) &&
        !(secret instanceof DataView) &&
        secret.BYTES_PER_ELEMENT === 1;
    if (!isByteView || secret.length < MIN_SECRET_BYTES) throw new TypeError(SECRET_ERROR);
    const bytes = new Uint8Array(secret.buffer, secret.byteOffset, secret.byteLength);
    if (bytes.every(byte => byte === 0)) throw new TypeError('signerSecret must not be all zero bytes');
    return bytes;
}

/**
 * Validate a signer secret without deriving anything from it.
 * @param {Uint8Array} secret
 * @returns {Uint8Array} a view over the same bytes
 */
function validateSignerSecret(secret) {
    return toSecretBytes(secret);
}

/**
 * Derive the private circuit input `signer_key` from a signer secret.
 * The same secret always yields the same key, so a synced passkey restores
 * the same signer on a new device.
 *
 * @param {Uint8Array} secret at least 32 bytes
 * @returns {string} decimal field element, ready for the Groth16 witness
 */
function deriveSignerKey(secret) {
    const bytes = toSecretBytes(secret);
    const domain = new TextEncoder().encode(SIGNER_KEY_DOMAIN);
    const input = new Uint8Array(domain.length + 1 + bytes.length);
    input.set(domain);
    input[domain.length] = 0;
    input.set(bytes, domain.length + 1);
    const digest = sha256(input);
    input.fill(0);

    let key = 0n;
    for (let i = 0; i < SCALAR_BYTES; i++) key = (key << 8n) | BigInt(digest[i]);
    digest.fill(0);
    // The circuit rejects a zero key; the probability is 2^-248.
    if (key === 0n) throw new Error('derived signer key is zero; use a different secret');
    return key.toString();
}

module.exports = { deriveSignerKey, validateSignerSecret, SIGNER_KEY_DOMAIN, MIN_SECRET_BYTES };
