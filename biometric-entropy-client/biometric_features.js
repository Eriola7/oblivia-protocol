/**
 * Standalone copy of sdk/lib/biometric_features.js: this package must not depend
 * on a sibling SDK installation. Regression tests keep their behavior aligned.
 */
function validateBiometricFeatures(features) {
    if (!Array.isArray(features) || features.length !== 20) {
        throw new TypeError('biometricFeatures must be a dense array of exactly 20 finite numbers in [0, 1]');
    }
    const validated = [];
    for (let i = 0; i < 20; i++) {
        if (!Object.prototype.hasOwnProperty.call(features, i)) {
            throw new TypeError('biometricFeatures must be a dense array of exactly 20 finite numbers in [0, 1]');
        }
        const value = features[i];
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
            throw new TypeError('biometricFeatures must be a dense array of exactly 20 finite numbers in [0, 1]');
        }
        validated.push(value);
    }
    return validated;
}

module.exports = { validateBiometricFeatures };
