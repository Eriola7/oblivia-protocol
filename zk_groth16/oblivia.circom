pragma circom 2.0.0;

include "node_modules/circomlib/circuits/poseidon.circom";

/*
 * Oblivia Intent Circuit — Groth16
 * 
 * Proves:
 * 1. Signer knows a private key (key_commitment = Poseidon(signer_key))
 * 2. Signature binds to specific contract + timestamp
 *    (sig_commitment = Poseidon(signer_key, contract_hash, timestamp))
 *
 * Private inputs: signer_key, contract_hash, timestamp
 * Public outputs: key_commitment, sig_commitment
 */
template OblividIntent() {
    // Private inputs
    signal input signer_key;
    signal input contract_hash;
    signal input timestamp;

    // Public outputs
    signal output key_commitment;
    signal output sig_commitment;

    // Constraint: signer_key must be non-zero
    signal key_inv;
    key_inv <-- 1 / signer_key;
    signer_key * key_inv === 1;

    // Constraint: timestamp must be non-zero
    signal ts_inv;
    ts_inv <-- 1 / timestamp;
    timestamp * ts_inv === 1;

    // Key commitment — proves identity without revealing key
    component key_hasher = Poseidon(1);
    key_hasher.inputs[0] <== signer_key;
    key_commitment <== key_hasher.out;

    // Signature commitment — binds key + contract + timestamp
    component sig_hasher = Poseidon(3);
    sig_hasher.inputs[0] <== signer_key;
    sig_hasher.inputs[1] <== contract_hash;
    sig_hasher.inputs[2] <== timestamp;
    sig_commitment <== sig_hasher.out;
}

component main = OblividIntent();
