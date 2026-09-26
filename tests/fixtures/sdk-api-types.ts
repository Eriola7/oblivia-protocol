// Compile-only checks for the Node SDK's supported return shapes; no transactions.
import {
    deriveKey, generateProof, signContract, signMultiSig,
    createMultiSigContract, finalizeMultiSigContract, initializeRegistry,
} from '../../sdk';
import type { PublicKey } from '@solana/web3.js';

async function checkApi(features: number[], text: string, bytes: Uint8Array) {
    const derived = deriveKey(features);
    const key: string = derived.key;
    const sketch: string = derived.sketch;
    // @ts-expect-error The Node result is an object, not a key string.
    deriveKey(features).slice(0, 32);
    const proof = await generateProof(features, bytes);
    const publicInputs: number[] = proof.publicInputs;
    const single = await signContract(features, text);
    const signature: string = single.transaction;
    const commitment: number[] = single.keyCommitment;
    const agreement = await createMultiSigContract(bytes, 2, 3);
    const address: string = agreement.multisigAddress;
    const creation: string | null = agreement.transaction;
    const member = await signMultiSig(features, bytes);
    const verified: true = member.verified;
    // @ts-expect-error Signing returns a receipt, not a separate status lookup.
    member.state.finalized;
    const finalization = await finalizeMultiSigContract(text);
    const finalTx: string | null = finalization.transaction;
    const registry: PublicKey = await initializeRegistry();
    return { key, sketch, publicInputs, signature, commitment, address, creation, verified, finalTx, registry };
}

void checkApi;
