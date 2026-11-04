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

/**
 * Seeds for an agreement's on-chain address. The settings are part of the
 * address, so a contract's agreement with other settings is a separate
 * account and cannot be claimed first by someone else.
 */
function multisigSeeds(contractHash, threshold, maxSigners) {
    validateMultisigConfig(threshold, maxSigners);
    const hash = Buffer.from(contractHash);
    if (hash.length !== 32) throw new Error('contractHash must be 32 bytes');
    return [Buffer.from('oblivia_multisig'), hash, Buffer.from([threshold]), Buffer.from([maxSigners])];
}

module.exports = { validateMultisigConfig, assertMultisigConfig, multisigSeeds };
