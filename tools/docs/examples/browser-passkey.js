// Browser: unlock a passkey with Face ID / Touch ID and prove locally.
import { createSignerPasskey, getPasskeySecret, generateProof } from '@oblivia/sdk/browser';

export async function firstTimeSetup() {
    // Once per user, on your permanent domain (see Getting started: passkeys and domains).
    await createSignerPasskey({ rpId: 'example.com', rpName: 'My App' });
}

export async function sign(contractText) {
    const secret = await getPasskeySecret({ rpId: 'example.com' });
    try {
        return await generateProof(secret, contractText, {
            wasmUrl: '/proving/oblivia.wasm',
            zkeyUrl: '/proving/oblivia_1.zkey',
        });
    } finally {
        secret.fill(0);
    }
    // Submit the result through your relay (see the relay API reference).
}
