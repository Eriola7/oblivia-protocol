use crate::constants::{CONTRACT_SEED, REGISTRY_SEED, SIGNATURE_SEED, SIGNER_RECORD_SEED};
use crate::error::ObliviaError;
use crate::state::{Contract, ContractRegistry, ObliviaSignature, SignerRecord};
use anchor_lang::prelude::*;

pub fn submit_signature_handler(
    _ctx: Context<SubmitSignature>,
    _key_commitment: [u8; 32],
    _signature_commitment: [u8; 32],
) -> Result<()> {
    // FAIL CLOSED: the previous implementation stored arbitrary caller-provided
    // commitments. The current Groth16 verifier has no public contract-hash input,
    // so it cannot prove that a commitment authorizes this contract. Do not enable
    // signing until the regenerated circuit and verifying key are wired into one
    // atomic, contract-bound submission instruction.
    err!(ObliviaError::ProofBindingUnavailable)
}

#[derive(Accounts)]
#[instruction(key_commitment: [u8; 32], signature_commitment: [u8; 32])]
pub struct SubmitSignature<'info> {
    #[account(mut, seeds = [REGISTRY_SEED], bump = registry.bump)]
    pub registry: Account<'info, ContractRegistry>,
    #[account(mut, seeds = [CONTRACT_SEED, &contract.contract_hash], bump = contract.bump)]
    pub contract: Account<'info, Contract>,
    #[account(
        init, payer = payer, space = ObliviaSignature::LEN,
        // A signature belongs to one contract. Including the contract PDA prevents a
        // valid record on one contract from blocking the same signer elsewhere.
        seeds = [SIGNATURE_SEED, contract.key().as_ref(), &key_commitment, &signature_commitment], bump
    )]
    pub signature: Account<'info, ObliviaSignature>,
    /// Deduplication PDA — init fails if same key signs same contract twice
    #[account(
        init, payer = payer, space = SignerRecord::LEN,
        seeds = [SIGNER_RECORD_SEED, &contract.contract_hash, &key_commitment], bump
    )]
    pub signer_record: Account<'info, SignerRecord>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}
