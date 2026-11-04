//! Adversarial tests for the production proof-acceptance logic.
//!
//! These call `verify_contract_bound_proof`, the exact function the
//! `verify_groth16_v2` instruction runs before writing any state. Off-chain,
//! the verifier uses the same BN254 arithmetic as Solana's alt_bn128 syscalls,
//! so these run without a Solana toolchain. `multisig_proof_gate.rs` covers the
//! on-chain wiring (atomic rollback, PDAs, counters) inside a local VM.
use ark_bn254::{Fq, Fr, G1Affine};
use ark_ec::AffineRepr;
use ark_ff::{BigInteger, PrimeField};
use oblivia_contracts::instructions::verify_groth16_v2::verify_contract_bound_proof;
use std::str::FromStr;

const PROOF: &str = include_str!("../../../../zk_groth16/proof.json");
const PUBLIC: &str = include_str!("../../../../zk_groth16/public.json");

fn be32(field_element_decimal: &str) -> [u8; 32] {
    Fq::from_str(field_element_decimal)
        .unwrap()
        .into_bigint()
        .to_bytes_be()
        .try_into()
        .unwrap()
}

fn fq_bytes(value: Fq) -> [u8; 32] {
    value.into_bigint().to_bytes_be().try_into().unwrap()
}

/// Scalar-field element as 32 big-endian bytes (public inputs live in Fr).
fn fr_bytes(value: Fr) -> [u8; 32] {
    value.into_bigint().to_bytes_be().try_into().unwrap()
}

#[derive(Clone)]
struct Case {
    hash: [u8; 32],
    a: [u8; 64],
    b: [u8; 128],
    c: [u8; 64],
    inputs: [u8; 128],
    key: [u8; 32],
    sig: [u8; 32],
}

impl Case {
    /// The committed development proof, serialized exactly as the SDK does.
    fn genuine() -> Self {
        let proof: serde_json::Value = serde_json::from_str(PROOF).unwrap();
        let signals: Vec<String> = serde_json::from_str(PUBLIC).unwrap();
        let s = |v: &serde_json::Value| be32(v.as_str().unwrap());
        let neg_y = fq_bytes(-Fq::from_str(proof["pi_a"][1].as_str().unwrap()).unwrap());
        let a: [u8; 64] = [s(&proof["pi_a"][0]).as_slice(), &neg_y].concat().try_into().unwrap();
        let b: [u8; 128] = [
            s(&proof["pi_b"][0][1]),
            s(&proof["pi_b"][0][0]),
            s(&proof["pi_b"][1][1]),
            s(&proof["pi_b"][1][0]),
        ]
        .concat()
        .try_into()
        .unwrap();
        let c: [u8; 64] = [s(&proof["pi_c"][0]), s(&proof["pi_c"][1])].concat().try_into().unwrap();
        let inputs: [u8; 128] = signals.iter().flat_map(|v| be32(v)).collect::<Vec<_>>().try_into().unwrap();
        let hash: [u8; 32] = [&be32(&signals[2])[16..], &be32(&signals[3])[16..]]
            .concat()
            .try_into()
            .unwrap();
        Self { hash, a, b, c, inputs, key: be32(&signals[0]), sig: be32(&signals[1]) }
    }

    fn verify(&self) -> Result<(), String> {
        verify_contract_bound_proof(self.hash, &self.a, &self.b, &self.c, &self.inputs, &self.key, &self.sig)
            .map_err(|e| e.to_string())
    }

    /// Replace a public input and its matching instruction argument consistently,
    /// so the forgery passes the argument checks and must fail the pairing.
    fn with_input(mut self, index: usize, value: [u8; 32]) -> Self {
        self.inputs[index * 32..(index + 1) * 32].copy_from_slice(&value);
        match index {
            0 => self.key = value,
            1 => self.sig = value,
            _ => {}
        }
        self
    }

    fn input(&self, index: usize) -> [u8; 32] {
        self.inputs[index * 32..(index + 1) * 32].try_into().unwrap()
    }
}

fn assert_rejected(name: &str, case: Case) {
    match case.verify() {
        Ok(()) => panic!("{name}: forged or malformed proof was ACCEPTED"),
        Err(e) => assert!(e.contains("InvalidProof"), "{name}: unexpected error {e}"),
    }
}

fn add_one(bytes: [u8; 32]) -> [u8; 32] {
    fr_bytes(Fr::from_be_bytes_mod_order(&bytes) + Fr::from(1u64))
}

#[test]
fn genuine_proof_is_accepted() {
    Case::genuine().verify().expect("the committed development proof must verify");
}

// ---- Contract binding and argument consistency (checked before the pairing) ----

#[test]
fn proof_for_another_contract_is_rejected() {
    for byte in [0usize, 15, 16, 31] {
        let mut case = Case::genuine();
        case.hash[byte] ^= 1;
        assert_rejected(&format!("contract hash byte {byte} changed"), case);
    }
}

#[test]
fn commitment_arguments_must_match_the_proven_inputs() {
    let mut case = Case::genuine();
    case.key[31] ^= 1;
    assert_rejected("key commitment argument differs from proven input", case);
    let mut case = Case::genuine();
    case.sig[31] ^= 1;
    assert_rejected("signature commitment argument differs from proven input", case);
}

// ---- Well-formed forgeries: valid encodings that must fail the pairing check ----

#[test]
fn substituted_public_inputs_fail_the_pairing() {
    let g = Case::genuine();
    assert_rejected("substituted key commitment", g.clone().with_input(0, add_one(g.input(0))));
    assert_rejected("substituted signature commitment", g.clone().with_input(1, add_one(g.input(1))));
    assert_rejected("key and signature commitments swapped", {
        let (k, s) = (g.input(0), g.input(1));
        g.clone().with_input(0, s).with_input(1, k)
    });
}

#[test]
fn tampered_proof_points_fail_the_pairing() {
    let g = Case::genuine();

    let proof: serde_json::Value = serde_json::from_str(PROOF).unwrap();
    let mut not_negated = g.clone();
    not_negated.a[32..].copy_from_slice(&be32(proof["pi_a"][1].as_str().unwrap()));
    assert_rejected("A not negated (client serialization bug)", not_negated);

    let mut swapped = g.clone();
    swapped.a = g.c;
    swapped.c = g.a;
    assert_rejected("A and C swapped", swapped);

    let generator = G1Affine::generator();
    let mut a_generator = g.clone();
    a_generator.a = [fq_bytes(generator.x), fq_bytes(generator.y)].concat().try_into().unwrap();
    assert_rejected("A replaced by the G1 generator", a_generator);

    let mut c_is_a = g.clone();
    c_is_a.c = g.a;
    assert_rejected("C replaced by A", c_is_a);

    let mut b_order = g.clone();
    b_order.b = [&g.b[32..64], &g.b[0..32], &g.b[96..128], &g.b[64..96]].concat().try_into().unwrap();
    assert_rejected("B coordinate order swapped", b_order);
}

#[test]
fn identity_points_are_rejected() {
    let g = Case::genuine();
    assert_rejected("A is the point at infinity", Case { a: [0; 64], ..g.clone() });
    assert_rejected("B is the point at infinity", Case { b: [0; 128], ..g.clone() });
    assert_rejected("C is the point at infinity", Case { c: [0; 64], ..g.clone() });
}

// ---- Malformed encodings ----

#[test]
fn points_off_the_curve_are_rejected() {
    let g = Case::genuine();
    let mut a = [0u8; 64];
    a[31] = 1; // x = 1
    a[63] = 3; // y = 3; the curve point with x = 1 has y = 2
    assert_rejected("A off the curve", Case { a, ..g.clone() });

    let mut c = g.c;
    c[63] ^= 1;
    assert_rejected("C off the curve (y changed by one bit)", Case { c, ..g.clone() });

    let mut b = g.b;
    b[127] ^= 1;
    assert_rejected("B off the curve (one coordinate changed)", Case { b, ..g.clone() });
}

#[test]
fn coordinates_outside_the_base_field_are_rejected() {
    let g = Case::genuine();
    assert_rejected("A filled with 0xff", Case { a: [0xff; 64], ..g.clone() });
    assert_rejected("B filled with 0xff", Case { b: [0xff; 128], ..g.clone() });
    assert_rejected("C filled with 0xff", Case { c: [0xff; 64], ..g.clone() });

    // x + p encodes the same residue as x but is not a canonical encoding.
    let modulus = <Fq as PrimeField>::MODULUS;
    let mut x = ark_ff::BigInt::<4>::from_bits_be(&g.a[..32].iter().flat_map(|byte| (0..8).rev().map(move |i| byte >> i & 1 == 1)).collect::<Vec<_>>());
    if !x.add_with_carry(&modulus) {
        let mut a = g.a;
        a[..32].copy_from_slice(&x.to_bytes_be());
        assert_rejected("A x-coordinate not reduced modulo p", Case { a, ..g.clone() });
    }
}

#[test]
fn non_canonical_public_inputs_are_rejected() {
    // A public input plus the scalar-field modulus r denotes the same field
    // element in different bytes. If accepted, one proof could be recorded
    // under several commitment byte strings, defeating per-key deduplication.
    let g = Case::genuine();
    let r = <Fr as PrimeField>::MODULUS;
    for index in [0usize, 1] {
        let mut value = ark_ff::BigInt::<4>::from_bits_be(
            &g.input(index).iter().flat_map(|byte| (0..8).rev().map(move |i| byte >> i & 1 == 1)).collect::<Vec<_>>(),
        );
        let overflow = value.add_with_carry(&r);
        assert!(!overflow, "test value must fit in 32 bytes");
        let bytes: [u8; 32] = value.to_bytes_be().try_into().unwrap();
        assert_rejected(&format!("public input {index} plus r"), g.clone().with_input(index, bytes));
    }
}
