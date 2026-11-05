#![allow(ambiguous_glob_reexports)]
use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

pub use constants::*;
pub use instructions::create_multisig::*;
pub use instructions::finalize_multisig::*;
pub use instructions::initialize::*;
pub use instructions::register_contract::*;
pub use instructions::submit_multisig_signature::*;
pub use instructions::submit_signature::*;
pub use instructions::verify_groth16_multisig_v2::*;
pub use instructions::verify_groth16_v2::*;
pub use instructions::verify_signature::*;
pub use state::*;

declare_id!("HaRpXyybfpYpwxkhfj8CjY8EjGqvRd96Zi33iSCTxvHG");

#[program]
pub mod oblivia_contracts {
    use super::*;

    /// Create the global contract registry. Run once per deployment.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize::initialize_handler(ctx)
    }

    /// Register a contract by its SHA-256 hash. Idempotent per hash: the
    /// contract PDA is derived from it. Must precede signing.
    pub fn register_contract(
        ctx: Context<RegisterContract>,
        contract_hash: [u8; 32],
    ) -> Result<()> {
        instructions::register_contract::register_contract_handler(ctx, contract_hash)
    }

    /// Disabled. Commitment-only submission without a proof; always fails
    /// with `ProofBindingUnavailable`. Use `verify_groth16_v2`.
    pub fn submit_signature(
        ctx: Context<SubmitSignature>,
        key_commitment: [u8; 32],
        signature_commitment: [u8; 32],
    ) -> Result<()> {
        instructions::submit_signature::submit_signature_handler(
            ctx,
            key_commitment,
            signature_commitment,
        )
    }

    /// Check that a recorded signature belongs to an active contract and log
    /// its public commitments. Read-only.
    pub fn verify_signature(ctx: Context<VerifySignature>) -> Result<()> {
        instructions::verify_signature::verify_signature_handler(ctx)
    }

    /// Create an M-of-N agreement for a registered contract. The agreement
    /// address is derived from the contract hash, `threshold` and
    /// `max_signers`, so its settings cannot be pre-empted or changed.
    /// Requires `1 <= threshold <= max_signers`.
    pub fn create_multisig(
        ctx: Context<CreateMultiSig>,
        contract_hash: [u8; 32],
        threshold: u8,
        max_signers: u8,
    ) -> Result<()> {
        instructions::create_multisig::create_multisig_handler(
            ctx,
            contract_hash,
            threshold,
            max_signers,
        )
    }

    /// Disabled. Commitment-only multisig submission; always fails with
    /// `ProofBindingUnavailable`. Use `verify_groth16_v2` then
    /// `record_verified_multisig`.
    pub fn submit_multisig_signature(
        ctx: Context<SubmitMultiSigSignature>,
        key_commitment: [u8; 32],
        signature_commitment: [u8; 32],
    ) -> Result<()> {
        instructions::submit_multisig_signature::submit_multisig_signature_handler(
            ctx,
            key_commitment,
            signature_commitment,
        )
    }

    /// Verify a contract-bound Groth16 proof on-chain and record the signature
    /// in the same instruction. Public inputs must carry the key commitment,
    /// signature commitment and both 128-bit limbs of the registered contract
    /// hash. Creates the signature receipt and signer record; nothing is
    /// written if any check fails.
    pub fn verify_groth16_v2(
        ctx: Context<VerifyGroth16V2>,
        proof_a: [u8; 64],
        proof_b: [u8; 128],
        proof_c: [u8; 64],
        pub_inputs: [u8; 128],
        key_commitment: [u8; 32],
        signature_commitment: [u8; 32],
    ) -> Result<()> {
        instructions::verify_groth16_v2::verify_groth16_v2_handler(
            ctx,
            proof_a,
            proof_b,
            proof_c,
            pub_inputs,
            key_commitment,
            signature_commitment,
        )
    }

    /// Count a verified signer toward a multisig agreement. Requires the
    /// signer record and signature receipt created by `verify_groth16_v2` for
    /// this contract and key commitment. Each key counts once; the agreement
    /// finalizes automatically at its threshold.
    pub fn record_verified_multisig(
        ctx: Context<RecordVerifiedMultiSig>,
        contract_hash: [u8; 32],
        key_commitment: [u8; 32],
    ) -> Result<()> {
        // Anchor uses this instruction argument while deriving the contract PDAs.
        let _ = contract_hash;
        instructions::verify_groth16_multisig_v2::record_verified_multisig_handler(
            ctx,
            key_commitment,
        )
    }

    /// Mark an agreement finalized once its threshold is met. Normally
    /// unnecessary: counting the last required signature finalizes it.
    pub fn finalize_multisig(
        ctx: Context<FinalizeMultiSig>,
        contract_hash: [u8; 32],
    ) -> Result<()> {
        instructions::finalize_multisig::finalize_multisig_handler(ctx, contract_hash)
    }
}
