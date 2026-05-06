const { sha256 } = require('@noble/hashes/sha2.js');

function quantizeFeatures(features, bits = 8) {
    const levels = Math.pow(2, bits);
    return features.map(f => Math.round(f * (levels - 1)));
}

function applyErrorCorrection(quantized) {
    const bucketSize = 64;
    return quantized.map(v => Math.floor(v / bucketSize) * bucketSize);
}

function featuresToBytes(corrected) {
    return new Uint8Array(corrected.map(v => v & 0xFF));
}

function deriveKey(features, salt = 'oblivia-v1') {
    const quantized = quantizeFeatures(features);
    const corrected = applyErrorCorrection(quantized);
    const bytes = featuresToBytes(corrected);
    
    const saltBytes = new TextEncoder().encode(salt);
    const combined = new Uint8Array(bytes.length + saltBytes.length);
    combined.set(bytes);
    combined.set(saltBytes, bytes.length);
    
    const hash = sha256(combined);
    return Buffer.from(hash).toString('hex');
}

function verifyMatch(features1, features2) {
    const key1 = deriveKey(features1);
    const key2 = deriveKey(features2);
    return key1 === key2;
}

module.exports = { deriveKey, verifyMatch, quantizeFeatures };
