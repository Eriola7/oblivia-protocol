use anchor_lang::prelude::*;
use crate::state::{ContractRegistry, Contract, ObliviaSignature};
use crate::constants::{REGISTRY_SEED, CONTRACT_SEED, SIGNATURE_SEED};
use crate::error::ObliviaError;

pub fn submit_signature_handler(
    ctx: Context<SubmitSignature>,
    key_commitment: [u8; 32],
    signature_commitment: [u8; 32],
) -> Result<()> {
    require!(ctx.accounts.contract.active, ObliviaError::ContractInactive);
    require!(key_commitment != [0u8; 32], ObliviaError::InvalidKeyCommitment);
    require!(signature_commitment != [0u8; 32], ObliviaError::InvalidSignatureCommitment);

    let contract = &mut ctx.accounts.contract;
    let signature = &mut ctx.accounts.signature;
    let registry = &mut ctx.accounts.registry;

    signature.key_commitment = key_commitment;
    signature.signature_commitment = signature_commitment;
    signature.contract = contract.key();
    signature.timestamp = Clock::get()?.unix_timestamp;
    signature.bump = ctx.bumps.signature;

    contract.signature_count += 1;
    registry.total_signatures += 1;

    msg!("Signature submitted. Key commitment: {:?}", key_commitment);
    Ok(())
}

#[derive(Accounts)]
#[instruction(key_commitment: [u8; 32], signature_commitment: [u8; 32])]
pub struct SubmitSignature<'info> {
    #[account(
        mut,
        seeds = [REGISTRY_SEED],
        bump = registry.bump
    )]
    pub registry: Account<'info, ContractRegistry>,
    #[account(
        mut,
        seeds = [CONTRACT_SEED, &contract.contract_hash],
        bump = contract.bump
    )]
    pub contract: Account<'info, Contract>,
    #[account(
        init,
        payer = payer,
        space = ObliviaSignature::LEN,
        seeds = [SIGNATURE_SEED, &key_commitment, &signature_commitment],
        bump
    )]
    pub signature: Account<'info, ObliviaSignature>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}
