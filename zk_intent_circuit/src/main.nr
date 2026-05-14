fn main(
    contract_hash: [u8; 32],
    signer_key: Field,
    timestamp: u64
) -> pub (Field, [u8; 32]) {
    assert(signer_key != 0);
    assert(timestamp > 0);

    // Cryptographic commitment to signer key using Pedersen hash
    // Proves knowledge of signer_key without revealing it
    // Verifier sees commitment but never learns the actual key
    let key_commitment = std::hash::pedersen_hash([signer_key]);

    (key_commitment, contract_hash)
}

#[test]
fn test_intent_proof() {
    let hash: [u8; 32] = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32];
    let key: Field = 12345678;
    let timestamp: u64 = 1000000000;
    
    let (commitment, returned_hash) = main(hash, key, timestamp);
    
    // Commitment should be deterministic
    let (commitment2, _) = main(hash, key, timestamp);
    assert(commitment == commitment2);
    
    // Different key should produce different commitment
    let (commitment3, _) = main(hash, 99999999, timestamp);
    assert(commitment != commitment3);
    
    // Contract hash should be preserved
    assert(returned_hash[0] == 1);
}
