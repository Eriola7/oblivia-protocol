// Shared by SDK and relay: never silently reuse a different agreement policy.
function validateMultisigConfig(threshold, maxSigners) {
    if (!Number.isInteger(threshold) || !Number.isInteger(maxSigners) ||
        threshold < 1 || maxSigners < threshold || maxSigners > 255) {
        throw new Error('Multisig requires integer values: 1 <= threshold <= maxSigners <= 255');
    }
}

function assertMultisigConfig(existing, threshold, maxSigners) {
    validateMultisigConfig(threshold, maxSigners);
    if (existing.threshold !== threshold || existing.maxSigners !== maxSigners) {
        throw new Error('This contract already has different multisig settings; use distinct contract text for a new agreement');
    }
}

module.exports = { validateMultisigConfig, assertMultisigConfig };
