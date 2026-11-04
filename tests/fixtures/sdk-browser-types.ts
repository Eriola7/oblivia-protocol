// Compiled in the SDK package scope by sdk_package_contract.test.js.
import { createSignerPasskey, deriveSignerKey, generateProof, getPasskeySecret, PasskeyUnavailableError } from '@oblivia/sdk/browser';
import type { BrowserProofResult, Groth16Proof, ProvingAssets } from '@oblivia/sdk/browser';
// @ts-expect-error The browser entry point does not submit transactions.
import { signContract } from '@oblivia/sdk/browser';

async function checkBrowserApi(features: number[], text: string, bytes: Uint8Array) {
    const { credentialId } = await createSignerPasskey({ rpName: 'Example' });
    const secret: Uint8Array = await getPasskeySecret({ credentialId });
    const key: string = deriveSignerKey(secret, bytes);
    // @ts-expect-error Keys are per contract; the contract hash is required.
    deriveSignerKey(secret);
    // @ts-expect-error Biometric measurement arrays are no longer accepted.
    deriveSignerKey(features, bytes);
    const error: Error = new PasskeyUnavailableError('unsupported');
    const assets: ProvingAssets = { wasmUrl: '/oblivia.wasm', zkeyUrl: '/oblivia.zkey' };
    const result: BrowserProofResult = await generateProof(secret, text, assets);
    await generateProof(secret, bytes, assets);
    const proof: Groth16Proof = result.proof;
    const x: string = proof.pi_a[0];
    const y: string = proof.pi_b[0][1];
    const hash: number[] = result.contractHash;
    const inputs: string[] = result.publicInputs;
    const verified: true = result.verified;
    // @ts-expect-error Browser proving requires explicit asset URLs.
    generateProof(secret, text);
    // @ts-expect-error Both URLs are required.
    generateProof(secret, text, { wasmUrl: '/oblivia.wasm' });
    // @ts-expect-error Browser public inputs are decimal strings, not Anchor bytes.
    const anchorInputs: number[] = result.publicInputs;
    // @ts-expect-error Local proof generation is not an on-chain submission.
    result.transaction;
    return { key, error, proof, x, y, hash, inputs, verified };
}

void checkBrowserApi;
