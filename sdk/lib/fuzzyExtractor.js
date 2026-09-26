const { sha256 } = require('@noble/hashes/sha2.js');
const { validateBiometricFeatures } = require('./biometric_features');

/**
 * Oblivia prototype biometric key derivation.
 * Quantizes 20 normalized measurements, coarsely buckets them, then hashes the
 * resulting bytes with a domain-separation salt. This is not a hardened fuzzy
 * extractor: stability, entropy, liveness and human uniqueness are unproven.
 * The residual "sketch" is not used by reproduce() and has no privacy guarantee.
 */

const BUCKET_SIZE = 64;
const BITS = 8;

function quantizeFeatures(features) {
    const levels = Math.pow(2, BITS);
    return validateBiometricFeatures(features).map(f => Math.round(f * (levels - 1)));
}

function applyErrorCorrection(quantized) {
    return quantized.map(v => Math.floor(v / BUCKET_SIZE) * BUCKET_SIZE);
}

function featuresToBytes(corrected) {
    return new Uint8Array(corrected.map(v => v & 0xFF));
}

function bytesToHex(bytes) {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Derive a prototype key and residual sketch from local input.
 * Do not publish the sketch: its biometric information leakage is not assessed.
 * @param {number[]} features - exactly 20 finite measurements in [0, 1]
 * @returns {{ key: string, sketch: string }}
 */
function generate(features, salt = 'oblivia-v1') {
    const quantized = quantizeFeatures(features);
    const corrected = applyErrorCorrection(quantized);
    const bytes = featuresToBytes(corrected);

    const saltBytes = new TextEncoder().encode(salt);
    const combined = new Uint8Array(bytes.length + saltBytes.length);
    combined.set(bytes);
    combined.set(saltBytes, bytes.length);

    const key = bytesToHex(sha256(combined));

    // Residual sketch retained for API compatibility; not used for recovery.
    const sketch = quantized.map((v, i) => v ^ corrected[i]);
    const sketchHex = bytesToHex(Uint8Array.from(sketch));

    return { key, sketch: sketchHex };
}

/**
 * Derive a key again using the same quantization and bucketing.
 * Readings match only if every measurement remains in its original bucket.
 * @param {number[]} features - exactly 20 finite measurements in [0, 1]
 * @param {string} sketchHex - unused residual retained for API compatibility
 * @returns {string} - reconstructed key
 */
function reproduce(features, sketchHex, salt = 'oblivia-v1') {
    // This prototype does not perform sketch-based reconstruction.
    const quantized = quantizeFeatures(features);
    const corrected = applyErrorCorrection(quantized);

    const bytes = featuresToBytes(corrected);
    const saltBytes = new TextEncoder().encode(salt);
    const combined = new Uint8Array(bytes.length + saltBytes.length);
    combined.set(bytes);
    combined.set(saltBytes, bytes.length);

    return bytesToHex(sha256(combined));
}

/**
 * Legacy deriveKey - direct key derivation without sketch
 * Used for browser client integration
 */
function deriveKey(features, salt = 'oblivia-v1') {
    return generate(features, salt).key;
}

function verifyMatch(features1, features2) {
    return deriveKey(features1) === deriveKey(features2);
}

module.exports = { generate, reproduce, deriveKey, verifyMatch, quantizeFeatures };
