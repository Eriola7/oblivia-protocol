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
