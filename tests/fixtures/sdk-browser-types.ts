// Compiled in the SDK package scope by sdk_package_contract.test.js.
import { deriveKey, generateProof } from '@oblivia/sdk/browser';
import type { BrowserProofResult, Groth16Proof, ProvingAssets } from '@oblivia/sdk/browser';
// @ts-expect-error The browser entry point does not submit transactions.
import { signContract } from '@oblivia/sdk/browser';

async function checkBrowserApi(features: number[], text: string, bytes: Uint8Array) {
    const key: string = deriveKey(features);
    // @ts-expect-error Browser deriveKey returns a string, not the Node object.
    const nodeKey: { key: string; sketch: string } = deriveKey(features);
    const assets: ProvingAssets = { wasmUrl: '/oblivia.wasm', zkeyUrl: '/oblivia.zkey' };
    const result: BrowserProofResult = await generateProof(features, text, assets);
    await generateProof(features, bytes, assets);
    const proof: Groth16Proof = result.proof;
    const x: string = proof.pi_a[0];
    const y: string = proof.pi_b[0][1];
    const hash: number[] = result.contractHash;
    const inputs: string[] = result.publicInputs;
    const verified: true = result.verified;
    // @ts-expect-error Browser proving requires explicit asset URLs.
    generateProof(features, text);
    // @ts-expect-error Both URLs are required.
    generateProof(features, text, { wasmUrl: '/oblivia.wasm' });
    // @ts-expect-error Browser public inputs are decimal strings, not Anchor bytes.
    const anchorInputs: number[] = result.publicInputs;
    // @ts-expect-error Local proof generation is not an on-chain submission.
    result.transaction;
    return { key, proof, x, y, hash, inputs, verified };
}

void checkBrowserApi;
