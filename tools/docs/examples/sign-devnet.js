// Sign a contract on Devnet. Run with: node --env-file=.env sign-devnet.js
// .env must set OBLIVIA_DEVNET_KEY (hex 64-byte secret key with Devnet SOL).
const oblivia = require('@oblivia/sdk');

async function main() {
    const signerSecret = loadSignerSecret();
    const result = await oblivia.signContract(signerSecret, 'I agree to the terms of the pilot.');
    console.log('Verified on-chain:', result.verified);
    console.log('Transaction:      ', result.transaction);
}

// Replace with your key store (OS keychain, KMS, wallet). Losing it loses the signer.
function loadSignerSecret() {
    const hex = process.env.OBLIVIA_SIGNER_SECRET;
    if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) throw new Error('Set OBLIVIA_SIGNER_SECRET to 32 bytes of hex');
    return Uint8Array.from(Buffer.from(hex, 'hex'));
}

main()
    .catch(error => { console.error(error.message); process.exitCode = 1; })
    .finally(() => globalThis.curve_bn128 && globalThis.curve_bn128.terminate());
