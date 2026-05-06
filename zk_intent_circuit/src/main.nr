fn main(
    contract_hash: [u8; 32],
    signer_key: Field,
    timestamp: u64
) -> pub [u8; 32] {
    assert(signer_key != 0);
    assert(timestamp > 0);
    contract_hash
}

#[test]
fn test_intent_proof() {
    let hash: [u8; 32] = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32];
    let key: Field = 12345678;
    let timestamp: u64 = 1000000000;
    let result = main(hash, key, timestamp);
    assert(result[0] == 1);
}
