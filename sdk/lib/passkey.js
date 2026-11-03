/**
 * Passkey-backed signer secrets (browser only).
 *
 * Face ID / Touch ID / the platform PIN only unlocks a standard passkey. The
 * passkey's WebAuthn PRF extension returns a deterministic 32-byte secret for
 * a fixed salt, and that secret feeds ./signer_key.js. Because passkeys sync
 * through iCloud Keychain or Google Password Manager, signing in on a new
 * device with the same account restores the same secret and therefore the
 * same signer key. Oblivia stores nothing and implements no recovery of its
 * own.
 *
 * No biometric data reaches this code: the operating system performs user
 * verification and only releases the PRF output.
 *
 * The assertion is used solely to unlock the PRF output locally; it is not
 * sent to or verified by any server, so the challenge is a local random value.
 */
const { sha256 } = require('@noble/hashes/sha2.js');

const PRF_SALT = sha256(new TextEncoder().encode('oblivia/passkey-prf/v1'));

class PasskeyUnavailableError extends Error {
    constructor(message) {
        super(message);
        this.name = 'PasskeyUnavailableError';
    }
}

function webauthn(options) {
    const credentials = (options && options.credentials) ||
        (globalThis.navigator && globalThis.navigator.credentials);
    if (!credentials || typeof credentials.get !== 'function') {
        throw new PasskeyUnavailableError('Passkeys are not available in this browser');
    }
    return credentials;
}

function randomBytes(length) {
    const out = new Uint8Array(length);
    globalThis.crypto.getRandomValues(out);
    return out;
}

function toBase64Url(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value) {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64 + '='.repeat((4 - base64.length % 4) % 4));
    return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function prfOutput(credential) {
    const results = credential && typeof credential.getClientExtensionResults === 'function'
        ? credential.getClientExtensionResults()
        : {};
    const first = results && results.prf && results.prf.results && results.prf.results.first;
    if (!first) return null;
    const bytes = ArrayBuffer.isView(first)
        ? new Uint8Array(first.buffer, first.byteOffset, first.byteLength)
        : new Uint8Array(first);
    return bytes.length === 32 ? Uint8Array.from(bytes) : null;
}

/**
 * Create a discoverable, user-verified passkey for signing.
 *
 * @param {{ rpId?: string, rpName?: string, userName?: string, credentials?: CredentialsContainer }} [options]
 * @returns {Promise<{ credentialId: string }>}
 */
async function createSignerPasskey(options = {}) {
    const credentials = webauthn(options);
    const name = options.userName || 'Oblivia signer';
    const rp = { name: options.rpName || 'Oblivia' };
    if (options.rpId) rp.id = options.rpId;
    const credential = await credentials.create({
        publicKey: {
            challenge: randomBytes(32),
            rp,
            user: { id: randomBytes(16), name, displayName: name },
            pubKeyCredParams: [
                { type: 'public-key', alg: -7 },
                { type: 'public-key', alg: -257 },
            ],
            authenticatorSelection: {
                residentKey: 'required',
                requireResidentKey: true,
                userVerification: 'required',
            },
            extensions: { prf: {} },
        },
    });
    if (!credential) throw new PasskeyUnavailableError('Passkey creation was cancelled');
    const results = typeof credential.getClientExtensionResults === 'function'
        ? credential.getClientExtensionResults()
        : {};
    // Some platforms only report PRF support at assertion time; reject only an
    // explicit "not supported" here and let getPasskeySecret make the final check.
    if (results && results.prf && results.prf.enabled === false) {
        throw new PasskeyUnavailableError('This passkey provider does not support the PRF extension required for signing');
    }
    return { credentialId: toBase64Url(credential.rawId) };
}

/**
 * Unlock a passkey (Face ID / Touch ID / device PIN) and return its signer secret.
 *
 * @param {{ rpId?: string, credentialId?: string, credentials?: CredentialsContainer }} [options]
 * @returns {Promise<Uint8Array>} 32-byte secret; pass it to deriveSignerKey and discard it
 */
async function getPasskeySecret(options = {}) {
    const credentials = webauthn(options);
    const publicKey = {
        challenge: randomBytes(32),
        userVerification: 'required',
        extensions: { prf: { eval: { first: PRF_SALT } } },
    };
    if (options.rpId) publicKey.rpId = options.rpId;
    if (options.credentialId) {
        publicKey.allowCredentials = [{ type: 'public-key', id: fromBase64Url(options.credentialId) }];
    }
    const assertion = await credentials.get({ publicKey });
    if (!assertion) throw new PasskeyUnavailableError('Passkey unlock was cancelled');
    const secret = prfOutput(assertion);
    if (!secret) {
        throw new PasskeyUnavailableError('This passkey cannot derive a signing secret (WebAuthn PRF unsupported by the provider)');
    }
    return secret;
}

module.exports = { createSignerPasskey, getPasskeySecret, PasskeyUnavailableError, PRF_SALT };
