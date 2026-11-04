/**
 * Passkey domain policy.
 *
 * A passkey is bound to its relying-party ID (a registrable domain). Signers
 * created under a temporary or wrong domain cannot be used once the app moves,
 * so users would silently get a new signer identity. This check runs before
 * any passkey is created or unlocked:
 *
 * - Production: a permanent rpId is required, and the page must be served
 *   from that domain or one of its subdomains. The app can then move between
 *   subdomains (app.example.com -> sign.example.com) without losing signers.
 * - Local development: no rpId is needed on localhost.
 * - Explicit test builds (testMode): any host is allowed, and callers must
 *   tell users the signers are temporary.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const DOMAIN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

class PasskeyDomainError extends Error {
    constructor(message) {
        super(message);
        this.name = 'PasskeyDomainError';
    }
}

/**
 * @param {{ rpId?: string, testMode?: boolean }} config
 * @param {string} hostname the page's location.hostname
 * @returns {{ rpId?: string, temporary: boolean }} options for the passkey calls
 */
function checkPasskeyDomain(config, hostname) {
    const host = String(hostname || '').toLowerCase();
    const rpId = String((config && config.rpId) || '').trim().toLowerCase();

    if (rpId) {
        if (!DOMAIN.test(rpId)) {
            throw new PasskeyDomainError(`Configured passkey domain "${rpId}" is not a valid domain name`);
        }
        if (host !== rpId && !host.endsWith('.' + rpId)) {
            throw new PasskeyDomainError(`This page is served from ${host || 'an unknown host'}, not the passkey domain ${rpId}. Passkey signing is disabled here.`);
        }
        return { rpId, temporary: false };
    }
    if (LOCAL_HOSTS.has(host)) return { temporary: true };
    if (config && config.testMode === true) return { temporary: true };
    throw new PasskeyDomainError('No permanent passkey domain is configured for this build. Signers created here would be tied to a temporary address, so passkey signing is disabled.');
}

module.exports = { checkPasskeyDomain, PasskeyDomainError };
