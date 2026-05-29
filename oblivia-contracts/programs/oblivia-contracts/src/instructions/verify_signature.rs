use anchor_lang::prelude::*;
use crate::state::{Contract, ObliviaSignature};
use crate::constants::{CONTRACT_SEED, SIGNATURE_SEED};

pub fn verify_signature_handler(ctx: Context<VerifySignature>) -> Result<()> {
    let contract = &ctx.accounts.contract;
    let signature = &ctx.accounts.signature;

    require!(contract.active, crate::error::ObliviaError::ContractInactive);
    require!(
        signature.contract == contract.key(),
        crate::error::ObliviaError::InvalidSignatureCommitment
    );

    msg!("Signature verified.");
    msg!("Contract hash: {:?}", contract.contract_hash);
    msg!("Key commitment: {:?}", signature.key_commitment);
    msg!("Signature commitment: {:?}", signature.signature_commitment);
    msg!("Signed at: {}", signature.timestamp);
    msg!("Identity revealed: false");
    msg!("Data transmitted: false");
    Ok(())
}

#[derive(Accounts)]
pub struct VerifySignature<'info> {
    #[account(
        seeds = [CONTRACT_SEED, &contract.contract_hash],
        bump = contract.bump
    )]
    pub contract: Account<'info, Contract>,
    #[account(
        seeds = [SIGNATURE_SEED, &signature.key_commitment, &signature.signature_commitment],
        bump = signature.bump,
        constraint = signature.contract == contract.key()
    )]
    pub signature: Account<'info, ObliviaSignature>,
}
