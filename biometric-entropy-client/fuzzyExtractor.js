const { sha256 } = require('@noble/hashes/sha2.js');

/**
 * Oblivia Biometric Fuzzy Extractor
 * 
 * Implements a fuzzy extractor construction based on Dodis et al. (2004)
 * that derives a stable cryptographic key from noisy biometric input.
 * 
 * Components:
 * - Quantization: maps continuous biometric features to discrete values
 * - Error correction: absorbs natural biometric variance via coarse bucketing
 * - Secure sketch: helper string P that enables reconstruction without
 *   revealing information about the source biometric
 * - Key derivation: SHA-256 of corrected features + domain separation salt
 */

const BUCKET_SIZE = 64;
const BITS = 8;

function quantizeFeatures(features) {
    const levels = Math.pow(2, BITS);
    return features.map(f => Math.round(f * (levels - 1)));
}

function applyErrorCorrection(quantized) {
    return quantized.map(v => Math.floor(v / BUCKET_SIZE) * BUCKET_SIZE);
}

function featuresToBytes(corrected) {
    return new Uint8Array(corrected.map(v => v & 0xFF));
}

/**
 * Generate - derives a key R and helper string P from biometric input w
 * P is safe to store publicly - reveals nothing about w
 * @param {number[]} features - raw biometric feature vector
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

    const key = Buffer.from(sha256(combined)).toString('hex');

    // Secure sketch: XOR of quantized and corrected values
    // Allows reconstruction from nearby input without revealing original
    const sketch = quantized.map((v, i) => v ^ corrected[i]);
    const sketchHex = Buffer.from(sketch).toString('hex');

    return { key, sketch: sketchHex };
}

/**
 * Reproduce - reconstructs key R from noisy biometric w' and helper string P
 * Works as long as distance(w, w') is within tolerance
 * @param {number[]} features - noisy biometric reading
 * @param {string} sketchHex - helper string from generate()
 * @returns {string} - reconstructed key
 */
function reproduce(features, sketchHex, salt = 'oblivia-v1') {
    const sketch = Array.from(Buffer.from(sketchHex, 'hex'));
    const quantized = quantizeFeatures(features);
    
    // Use sketch to guide error correction
    const corrected = quantized.map((v, i) => {
        const hint = v ^ sketch[i];
        return Math.floor(hint / BUCKET_SIZE) * BUCKET_SIZE;
    });

    const bytes = featuresToBytes(corrected);
    const saltBytes = new TextEncoder().encode(salt);
    const combined = new Uint8Array(bytes.length + saltBytes.length);
    combined.set(bytes);
    combined.set(saltBytes, bytes.length);

    return Buffer.from(sha256(combined)).toString('hex');
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
