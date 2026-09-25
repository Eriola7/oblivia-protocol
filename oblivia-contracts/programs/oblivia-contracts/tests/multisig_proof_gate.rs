use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::{
    prelude::Pubkey, AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas,
};
use litesvm::LiteSVM;
use oblivia_contracts::{accounts, constants::*, instruction, state::*, ID};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;

struct Fixture {
    svm: LiteSVM,
    payer: Keypair,
    hash: [u8; 32],
    registry: Pubkey,
    contract: Pubkey,
    multisig: Pubkey,
}

impl Fixture {
    fn new() -> Self {
        Self::with_hash([42; 32])
    }

    fn with_hash(hash: [u8; 32]) -> Self {
        let mut svm = LiteSVM::new();
        let binary = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../target/deploy/oblivia_contracts.so"
        ))
        .expect("Run anchor build before this test");
        svm.add_program(ID, &binary).unwrap();
        let payer = Keypair::new();
        svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
        let (registry, rb) = Pubkey::find_program_address(&[REGISTRY_SEED], &ID);
        let (contract, cb) = Pubkey::find_program_address(&[CONTRACT_SEED, &hash], &ID);
        let (multisig, mb) = Pubkey::find_program_address(&[MULTISIG_SEED, &hash], &ID);
        let mut f = Self {
            svm,
            payer,
            hash,
            registry,
            contract,
            multisig,
        };
        f.put(
            registry,
            &ContractRegistry {
                authority: f.payer.pubkey(),
                total_contracts: 1,
                total_signatures: 0,
                bump: rb,
            },
            ID,
        );
        f.put(
            contract,
            &Contract {
                contract_hash: hash,
                timestamp: 0,
                signature_count: 0,
                active: true,
                bump: cb,
            },
            ID,
        );
        f.put(
            multisig,
            &MultiSigContract {
                contract,
                threshold: 2,
                signatures_collected: 0,
                max_signers: 3,
                finalized: false,
                finalized_at: 0,
                bump: mb,
            },
            ID,
        );
        f
    }

    // Seed fixtures only in the local VM. No network or wallet files are used.
    fn put<T: AccountSerialize>(&mut self, address: Pubkey, value: &T, owner: Pubkey) {
        let mut account = self.svm.get_account(&self.payer.pubkey()).unwrap();
        account.data.clear();
        value.try_serialize(&mut account.data).unwrap();
        account.owner = owner;
        account.lamports = 10_000_000;
        self.svm.set_account(address, account).unwrap();
    }

    fn record_address(&self, key: [u8; 32]) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[SIGNER_RECORD_SEED, &self.hash, &key], &ID)
    }

    fn signature_address(&self, key: [u8; 32], sig: [u8; 32]) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[SIGNATURE_SEED, self.contract.as_ref(), &key, &sig], &ID)
    }

    fn member_address(&self, key: [u8; 32]) -> Pubkey {
        Pubkey::find_program_address(&[MULTISIG_MEMBER_SEED, self.multisig.as_ref(), &key], &ID).0
    }

    // A record by itself is deliberately not called verified: legacy versions
    // created this exact account without requiring a proof.
    fn seed_record(&mut self, key: [u8; 32]) {
        let (address, bump) = self.record_address(key);
        self.put(
            address,
            &SignerRecord {
                contract: self.contract,
                key_commitment: key,
                timestamp: 0,
                bump,
            },
            ID,
        );
    }

    fn seed_signature(&mut self, key: [u8; 32], sig: [u8; 32]) -> Pubkey {
        let (address, bump) = self.signature_address(key, sig);
        self.put(
            address,
            &ObliviaSignature {
                key_commitment: key,
                signature_commitment: sig,
                contract: self.contract,
                timestamp: 0,
                bump,
            },
            ID,
        );
        address
    }

    // Seed both accounts only for constraint/threshold tests. Real pairing and
    // receipt creation are tested separately below using the committed proof.
    fn seed_verified_pair(&mut self, key: [u8; 32]) -> (Pubkey, Pubkey) {
        self.seed_record(key);
        let signature = self.seed_signature(key, [7; 32]);
        (self.record_address(key).0, signature)
    }

    fn count_instruction(&self, key: [u8; 32], record: Pubkey, signature: Pubkey) -> Instruction {
        Instruction {
            program_id: ID,
            accounts: accounts::RecordVerifiedMultiSig {
                registry: self.registry,
                contract: self.contract,
                multisig: self.multisig,
                signer_record: record,
                signature,
                multisig_member: self.member_address(key),
                payer: self.payer.pubkey(),
                system_program: Pubkey::default(),
            }
            .to_account_metas(None),
            data: instruction::RecordVerifiedMultisig {
                contract_hash: self.hash,
                key_commitment: key,
            }
            .data(),
        }
    }

    fn send(&mut self, instructions: &[Instruction]) -> Result<(), String> {
        self.svm.expire_blockhash();
        let tx = Transaction::new(
            &[&self.payer],
            Message::new(instructions, Some(&self.payer.pubkey())),
            self.svm.latest_blockhash(),
        );
        self.svm
            .send_transaction(tx)
            .map(|_| ())
            .map_err(|e| format!("{:?}", e))
    }

    fn count(&mut self, key: [u8; 32], record: Pubkey, signature: Pubkey) -> Result<(), String> {
        self.send(&[self.count_instruction(key, record, signature)])
    }

    fn state(&self) -> MultiSigContract {
        let account = self.svm.get_account(&self.multisig).unwrap();
        MultiSigContract::try_deserialize(&mut account.data.as_slice()).unwrap()
    }

    fn assert_no_count(&self, key: [u8; 32]) {
        assert_eq!(self.state().signatures_collected, 0);
        assert!(!self.state().finalized);
        assert!(self.svm.get_account(&self.member_address(key)).is_none());
    }

    fn assert_no_verification(&self, key: [u8; 32], sig: [u8; 32]) {
        self.assert_no_count(key);
        assert!(self.svm.get_account(&self.record_address(key).0).is_none());
        assert!(self
            .svm
            .get_account(&self.signature_address(key, sig).0)
            .is_none());
        let contract = self.svm.get_account(&self.contract).unwrap();
        let contract = Contract::try_deserialize(&mut contract.data.as_slice()).unwrap();
        let registry = self.svm.get_account(&self.registry).unwrap();
        let registry = ContractRegistry::try_deserialize(&mut registry.data.as_slice()).unwrap();
        assert_eq!(contract.signature_count, 0);
        assert_eq!(registry.total_signatures, 0);
    }
}

#[test]
fn unverified_missing_record_cannot_count() {
    let mut f = Fixture::new();
    let record = f.record_address([1; 32]).0;
    let signature = f.seed_signature([1; 32], [7; 32]);
    let err = f.count([1; 32], record, signature).unwrap_err();
    assert!(err.contains("AccountNotInitialized"), "{err}");
    f.assert_no_count([1; 32]);
}

#[test]
fn historical_record_without_contract_bound_signature_cannot_count() {
    let mut f = Fixture::new();
    let key = [1; 32];
    let sig = [7; 32];
    f.seed_record(key);
    let record = f.record_address(key).0;
    let signature = f.signature_address(key, sig).0;
    let err = f.count(key, record, signature).unwrap_err();
    assert!(err.contains("AccountNotInitialized"), "{err}");
    f.assert_no_count(key);
}

#[test]
fn historical_signature_namespace_cannot_authorize_counting() {
    let mut f = Fixture::new();
    let key = [1; 32];
    let sig = [7; 32];
    f.seed_record(key);
    let (old_signature, bump) = Pubkey::find_program_address(&[SIGNATURE_SEED, &key, &sig], &ID);
    f.put(
        old_signature,
        &ObliviaSignature {
            key_commitment: key,
            signature_commitment: sig,
            contract: f.contract,
            timestamp: 0,
            bump,
        },
        ID,
    );
    let record = f.record_address(key).0;
    let err = f.count(key, record, old_signature).unwrap_err();
    assert!(err.contains("ConstraintSeeds"), "{err}");
    f.assert_no_count(key);
    assert!(f
        .svm
        .get_account(&f.signature_address(key, sig).0)
        .is_none());
}

#[test]
fn forged_or_mismatched_records_cannot_count() {
    for case in 0..4 {
        let mut f = Fixture::new();
        let key = [1; 32];
        let signature = f.seed_signature(key, [7; 32]);
        let (address, bump) = f.record_address(key);
        let mut record = SignerRecord {
            contract: f.contract,
            key_commitment: key,
            timestamp: 0,
            bump,
        };
        let mut owner = ID;
        let mut supplied = address;
        match case {
            0 => owner = Pubkey::default(),
            1 => record.contract = Pubkey::new_unique(),
            2 => record.key_commitment = [2; 32],
            _ => supplied = f.record_address([2; 32]).0,
        }
        f.put(supplied, &record, owner);
        let err = f.count(key, supplied, signature).unwrap_err();
        let expected = [
            "AccountOwnedByWrongProgram",
            "ConstraintHasOne",
            "InvalidKeyCommitment",
            "ConstraintSeeds",
        ][case];
        assert!(err.contains(expected), "{err}");
        f.assert_no_count(key);
    }
}

#[test]
fn forged_or_mismatched_signatures_cannot_count() {
    for case in 0..5 {
        let mut f = Fixture::new();
        let key = [1; 32];
        let sig = [7; 32];
        f.seed_record(key);
        let (address, bump) = f.signature_address(key, sig);
        let mut signature = ObliviaSignature {
            key_commitment: key,
            signature_commitment: sig,
            contract: f.contract,
            timestamp: 0,
            bump,
        };
        let mut owner = ID;
        let mut supplied = address;
        match case {
            0 => owner = Pubkey::default(),
            1 => signature.contract = Pubkey::new_unique(),
            2 => signature.key_commitment = [2; 32],
            3 => supplied = f.signature_address([2; 32], sig).0,
            _ => signature.signature_commitment = [8; 32],
        }
        f.put(supplied, &signature, owner);
        let record = f.record_address(key).0;
        let err = f.count(key, record, supplied).unwrap_err();
        let expected = [
            "AccountOwnedByWrongProgram",
            "ConstraintHasOne",
            "InvalidKeyCommitment",
            "ConstraintSeeds",
            "ConstraintSeeds",
        ][case];
        assert!(err.contains(expected), "case {case}: {err}");
        f.assert_no_count(key);
    }
}

#[test]
fn verified_keys_count_once_and_finalize_at_threshold() {
    let mut f = Fixture::new();
    let (record, signature) = f.seed_verified_pair([1; 32]);
    f.count([1; 32], record, signature).unwrap();
    assert_eq!(f.state().signatures_collected, 1);
    assert!(!f.state().finalized);
    assert!(f.count([1; 32], record, signature).is_err());
    assert_eq!(f.state().signatures_collected, 1);
    let (second, second_signature) = f.seed_verified_pair([2; 32]);
    f.count([2; 32], second, second_signature).unwrap();
    assert_eq!(f.state().signatures_collected, 2);
    assert!(f.state().finalized);
    let (third, third_signature) = f.seed_verified_pair([3; 32]);
    let err = f.count([3; 32], third, third_signature).unwrap_err();
    assert!(err.contains("ContractInactive"), "{err}");
    assert_eq!(f.state().signatures_collected, 2);
}

#[test]
fn disabled_legacy_writers_cannot_create_contract_bound_receipts() {
    for multisig in [false, true] {
        let mut f = Fixture::new();
        let key = [1; 32];
        let sig = [7; 32];
        let signature = f.signature_address(key, sig).0;
        let (accounts, data) = if multisig {
            (
                accounts::SubmitMultiSigSignature {
                    registry: f.registry,
                    contract: f.contract,
                    signature,
                    multisig: f.multisig,
                    multisig_member: f.member_address(key),
                    payer: f.payer.pubkey(),
                    system_program: Pubkey::default(),
                }
                .to_account_metas(None),
                instruction::SubmitMultisigSignature {
                    key_commitment: key,
                    signature_commitment: sig,
                }
                .data(),
            )
        } else {
            (
                accounts::SubmitSignature {
                    registry: f.registry,
                    contract: f.contract,
                    signature,
                    signer_record: f.record_address(key).0,
                    payer: f.payer.pubkey(),
                    system_program: Pubkey::default(),
                }
                .to_account_metas(None),
                instruction::SubmitSignature {
                    key_commitment: key,
                    signature_commitment: sig,
                }
                .data(),
            )
        };
        let err = f
            .send(&[Instruction {
                program_id: ID,
                accounts,
                data,
            }])
            .unwrap_err();
        assert!(err.contains("ProofBindingUnavailable"), "{err}");
        f.assert_no_verification(key, sig);
    }
}

// Exercise the actual pairing syscalls and atomic verify+count transaction with
// the repository's development proof, rather than relying only on seeded state.
#[test]
fn real_proof_counts_and_invalid_proof_rolls_back() {
    use ark_ff::{BigInteger, PrimeField};
    use std::str::FromStr;
    let proof: serde_json::Value =
        serde_json::from_str(include_str!("../../../../zk_groth16/proof.json")).unwrap();
    let signals: Vec<String> =
        serde_json::from_str(include_str!("../../../../zk_groth16/public.json")).unwrap();
    let bytes = |s: &str| -> [u8; 32] {
        ark_bn254::Fq::from_str(s)
            .unwrap()
            .into_bigint()
            .to_bytes_be()
            .try_into()
            .unwrap()
    };
    let coordinate = |v: &serde_json::Value| bytes(v.as_str().unwrap());
    let neg_y = (-ark_bn254::Fq::from_str(proof["pi_a"][1].as_str().unwrap()).unwrap())
        .into_bigint()
        .to_bytes_be();
    let a: [u8; 64] = [coordinate(&proof["pi_a"][0]).as_slice(), neg_y.as_slice()]
        .concat()
        .try_into()
        .unwrap();
    let b: [u8; 128] = [
        coordinate(&proof["pi_b"][0][1]),
        coordinate(&proof["pi_b"][0][0]),
        coordinate(&proof["pi_b"][1][1]),
        coordinate(&proof["pi_b"][1][0]),
    ]
    .concat()
    .try_into()
    .unwrap();
    let c: [u8; 64] = [coordinate(&proof["pi_c"][0]), coordinate(&proof["pi_c"][1])]
        .concat()
        .try_into()
        .unwrap();
    let inputs: [u8; 128] = signals
        .iter()
        .flat_map(|s| bytes(s))
        .collect::<Vec<_>>()
        .try_into()
        .unwrap();
    let hash: [u8; 32] = [
        bytes(&signals[2])[16..].to_vec(),
        bytes(&signals[3])[16..].to_vec(),
    ]
    .concat()
    .try_into()
    .unwrap();
    let key = bytes(&signals[0]);
    let sig = bytes(&signals[1]);
    for case in [
        "atomic",
        "deferred",
        "invalid_proof",
        "wrong_low_limb",
        "wrong_high_limb",
    ] {
        let mut target_hash = hash;
        if case == "wrong_low_limb" {
            target_hash[0] ^= 1;
        }
        if case == "wrong_high_limb" {
            target_hash[16] ^= 1;
        }
        let mut f = Fixture::with_hash(target_hash);
        let record = f.record_address(key).0;
        let (signature, _) =
            Pubkey::find_program_address(&[SIGNATURE_SEED, f.contract.as_ref(), &key, &sig], &ID);
        let verify = Instruction {
            program_id: ID,
            accounts: accounts::VerifyGroth16V2 {
                registry: f.registry,
                contract: f.contract,
                signature,
                signer_record: record,
                payer: f.payer.pubkey(),
                system_program: Pubkey::default(),
            }
            .to_account_metas(None),
            data: instruction::VerifyGroth16V2 {
                proof_a: if case == "invalid_proof" { [0; 64] } else { a },
                proof_b: b,
                proof_c: c,
                pub_inputs: inputs,
                key_commitment: key,
                signature_commitment: sig,
            }
            .data(),
        };
        let count = f.count_instruction(key, record, signature);
        let result = if case == "deferred" {
            // Existing genuine v2 receipts remain valid across upgrades; no
            // migration or requirement to re-prove in this transaction is added.
            f.send(&[verify]).unwrap();
            assert_eq!(f.state().signatures_collected, 0);
            assert!(f.svm.get_account(&record).is_some());
            assert!(f.svm.get_account(&signature).is_some());
            f.send(&[count.clone()])
        } else {
            f.send(&[verify, count.clone()])
        };
        if case != "atomic" && case != "deferred" {
            let err = result.unwrap_err();
            assert!(err.contains("InvalidProof"), "case {case}: {err}");
            f.assert_no_verification(key, sig);
        } else {
            result.unwrap();
            assert_eq!(f.state().signatures_collected, 1);
            assert!(f.svm.get_account(&record).is_some());
            assert!(f.svm.get_account(&signature).is_some());
            assert!(f.send(&[count]).is_err());
            assert_eq!(f.state().signatures_collected, 1);
        }
    }
}
