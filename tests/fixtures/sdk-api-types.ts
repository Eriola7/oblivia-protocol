// Compile-only checks for the Node SDK's supported return shapes; no transactions.
import {
    deriveSignerKey, generateSignerSecret, generateProof, signContract, signMultiSig,
    createMultiSigContract, finalizeMultiSigContract, initializeRegistry,
} from '../../sdk';
import type { PublicKey } from '@solana/web3.js';

async function checkApi(features: number[], text: string, bytes: Uint8Array) {
    const secret: Uint8Array = generateSignerSecret();
    const key: string = deriveSignerKey(secret, bytes);
    // @ts-expect-error Keys are per contract; the contract hash is required.
    deriveSignerKey(secret);
    // @ts-expect-error Signer secrets are bytes, not biometric measurement arrays.
    deriveSignerKey(features, bytes);
    const proof = await generateProof(secret, bytes);
    const publicInputs: number[] = proof.publicInputs;
    const single = await signContract(secret, text);
    const signature: string = single.transaction;
    const commitment: number[] = single.keyCommitment;
    const agreement = await createMultiSigContract(bytes, 2, 3);
    const address: string = agreement.multisigAddress;
    const creation: string | null = agreement.transaction;
    const member = await signMultiSig(secret, bytes);
    const verified: true = member.verified;
    // @ts-expect-error Signing returns a receipt, not a separate status lookup.
    member.state.finalized;
    // @ts-expect-error The biometric-derivation API was removed.
    signMultiSig(features, bytes);
    const finalization = await finalizeMultiSigContract(text);
    const finalTx: string | null = finalization.transaction;
    const registry: PublicKey = await initializeRegistry();
    return { key, publicInputs, signature, commitment, address, creation, verified, finalTx, registry };
}

void checkApi;
