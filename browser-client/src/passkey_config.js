/* global __OBLIVIA_RP_ID__, __OBLIVIA_PASSKEY_TEST__ */
// Set at build time; see the README section "Passkey domain".
//   OBLIVIA_RP_ID=example.com npm run build      production signers bound to example.com
//   OBLIVIA_PASSKEY_TEST=1 npm run build         throwaway test signers on any host
module.exports = {
    rpId: typeof __OBLIVIA_RP_ID__ === 'string' ? __OBLIVIA_RP_ID__ : '',
    testMode: typeof __OBLIVIA_PASSKEY_TEST__ === 'boolean' ? __OBLIVIA_PASSKEY_TEST__ : false,
};
