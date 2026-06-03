#![allow(ambiguous_glob_reexports)]
use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

pub use constants::*;
pub use state::*;
pub use instructions::initialize::*;
pub use instructions::register_contract::*;
pub use instructions::submit_signature::*;
pub use instructions::verify_signature::*;
pub use instructions::create_multisig::*;
pub use instructions::finalize_multisig::*;
pub use instructions::submit_multisig_signature::*;

declare_id!("HaRpXyybfpYpwxkhfj8CjY8EjGqvRd96Zi33iSCTxvHG");

#[program]
pub mod oblivia_contracts {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize::initialize_handler(ctx)
    }

    pub fn register_contract(ctx: Context<RegisterContract>, contract_hash: [u8; 32]) -> Result<()> {
        instructions::register_contract::register_contract_handler(ctx, contract_hash)
    }

    pub fn submit_signature(ctx: Context<SubmitSignature>, key_commitment: [u8; 32], signature_commitment: [u8; 32]) -> Result<()> {
        instructions::submit_signature::submit_signature_handler(ctx, key_commitment, signature_commitment)
    }

    pub fn verify_signature(ctx: Context<VerifySignature>) -> Result<()> {
        instructions::verify_signature::verify_signature_handler(ctx)
    }

    pub fn create_multisig(ctx: Context<CreateMultiSig>, contract_hash: [u8; 32], threshold: u8, max_signers: u8) -> Result<()> {
        instructions::create_multisig::create_multisig_handler(ctx, contract_hash, threshold, max_signers)
    }

    pub fn submit_multisig_signature(ctx: Context<SubmitMultiSigSignature>, key_commitment: [u8; 32], signature_commitment: [u8; 32]) -> Result<()> {
        instructions::submit_multisig_signature::submit_multisig_signature_handler(ctx, key_commitment, signature_commitment)
    }

    pub fn finalize_multisig(ctx: Context<FinalizeMultiSig>, contract_hash: [u8; 32]) -> Result<()> {
        instructions::finalize_multisig::finalize_multisig_handler(ctx, contract_hash)
    }
}
