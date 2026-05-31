fn main(
    contract_hash: [u8; 32],
    signer_key: Field,
    timestamp: u64
) -> pub (Field, Field) {
    assert(signer_key != 0);
    assert(timestamp > 0);

    // Commitment 1: signer key commitment
    // Proves knowledge of signer_key without revealing it
    let key_commitment = std::hash::pedersen_hash([signer_key]);

    // Encode all 32 bytes of contract hash into two Field elements
    // First 16 bytes -> field_low, Last 16 bytes -> field_high
    let mut field_low: Field = 0;
    let mut field_high: Field = 0;

    for i in 0..16 {
        field_low = field_low * 256 + contract_hash[i] as Field;
    }
    for i in 16..32 {
        field_high = field_high * 256 + contract_hash[i] as Field;
    }

    // Commitment 2: signature commitment
    // Binds proof to specific contract (all 32 bytes), signer, and timestamp
    // Prevents proof reuse across different contracts
    let signature_commitment = std::hash::pedersen_hash([
        signer_key,
        field_low,
        field_high,
        timestamp as Field
    ]);

    (key_commitment, signature_commitment)
}

#[test]
fn test_intent_proof() {
    let hash: [u8; 32] = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32];
    let key: Field = 12345678;
    let timestamp: u64 = 1000000000;

    let (key_commitment, sig_commitment) = main(hash, key, timestamp);

    // Key commitment is deterministic
    let (key_commitment2, _) = main(hash, key, timestamp);
    assert(key_commitment == key_commitment2);

    // Different key produces different key commitment
    let (key_commitment3, _) = main(hash, 99999999, timestamp);
    assert(key_commitment != key_commitment3);

    // Different contract produces different signature commitment
    let hash2: [u8; 32] = [32,31,30,29,28,27,26,25,24,23,22,21,20,19,18,17,16,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1];
    let (_, sig_commitment2) = main(hash2, key, timestamp);
    assert(sig_commitment != sig_commitment2);

    // Different timestamp produces different signature commitment
    let (_, sig_commitment3) = main(hash, key, 2000000000);
    assert(sig_commitment != sig_commitment3);

    // Contracts differing only in last byte produce different commitments
    let hash3: [u8; 32] = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,99];
    let (_, sig_commitment4) = main(hash3, key, timestamp);
    assert(sig_commitment != sig_commitment4);
}

// Key commitment is independent of contract and timestamp
// A reviewer can verify the signer across multiple contracts
// without learning the signer's identity
#[test]
fn test_key_commitment_independence() {
    let hash1: [u8; 32] = [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
    let hash2: [u8; 32] = [2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
    let key: Field = 99887766;

    let (kc1, sc1) = main(hash1, key, 1000000000);
    let (kc2, sc2) = main(hash2, key, 2000000000);

    // Same key -> same key commitment regardless of contract or timestamp
    assert(kc1 == kc2);

    // Different contracts -> different signature commitments
    assert(sc1 != sc2);
}

// Signature commitment binds all inputs together
// Changing any single input produces a completely different commitment
#[test]
fn test_signature_commitment_binding() {
    let hash: [u8; 32] = [5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5];
    let key: Field = 11223344;
    let timestamp: u64 = 1700000000;

    let (_, sc_base) = main(hash, key, timestamp);

    // Change only first byte of hash
    let mut hash_mod1 = hash;
    hash_mod1[0] = 6;
    let (_, sc1) = main(hash_mod1, key, timestamp);
    assert(sc_base != sc1);

    // Change only middle byte of hash
    let mut hash_mod2 = hash;
    hash_mod2[15] = 6;
    let (_, sc2) = main(hash_mod2, key, timestamp);
    assert(sc_base != sc2);

    // Change only last byte of hash
    let mut hash_mod3 = hash;
    hash_mod3[31] = 6;
    let (_, sc3) = main(hash_mod3, key, timestamp);
    assert(sc_base != sc3);

    // All three modifications produce different commitments from each other
    assert(sc1 != sc2);
    assert(sc2 != sc3);
    assert(sc1 != sc3);
}

// Zero-knowledge property: different signers on same contract
// produce different key commitments -- signers are distinguishable
// but their identities remain hidden
#[test]
fn test_multisig_distinguishability() {
    let hash: [u8; 32] = [9,8,7,6,5,4,3,2,1,0,1,2,3,4,5,6,7,8,9,0,1,2,3,4,5,6,7,8,9,0,1,2];
    let timestamp: u64 = 1000000000;

    let key_a: Field = 111111111;
    let key_b: Field = 222222222;
    let key_c: Field = 333333333;

    let (kc_a, sc_a) = main(hash, key_a, timestamp);
    let (kc_b, sc_b) = main(hash, key_b, timestamp);
    let (kc_c, sc_c) = main(hash, key_c, timestamp);

    // All key commitments are distinct -- each signer is unique
    assert(kc_a != kc_b);
    assert(kc_b != kc_c);
    assert(kc_a != kc_c);

    // All signature commitments are distinct
    assert(sc_a != sc_b);
    assert(sc_b != sc_c);
    assert(sc_a != sc_c);
}

// Non-repudiation: same signer always produces same key commitment
// This is what allows on-chain verification of re-presented biometric
#[test]
fn test_non_repudiation() {
    let hash: [u8; 32] = [42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42];
    let key: Field = 987654321;

    // Same signer, same contract, different timestamps
    let (kc1, _) = main(hash, key, 1000000000);
    let (kc2, _) = main(hash, key, 1000000001);
    let (kc3, _) = main(hash, key, 9999999999);

    // Key commitment is always the same -- signer is identifiable
    // without revealing who they are
    assert(kc1 == kc2);
    assert(kc2 == kc3);
}
