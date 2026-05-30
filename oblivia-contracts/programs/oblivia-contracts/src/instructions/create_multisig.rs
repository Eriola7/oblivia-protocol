use anchor_lang::prelude::*;
use crate::state::{Contract, MultiSigContract};
use crate::constants::{CONTRACT_SEED, MULTISIG_SEED};
use crate::error::ObliviaError;

pub fn create_multisig_handler(
    ctx: Context<CreateMultiSig>,
    _contract_hash: [u8; 32],
    threshold: u8,
    max_signers: u8,
) -> Result<()> {
    require!(threshold > 0, ObliviaError::InvalidContractHash);
    require!(max_signers >= threshold, ObliviaError::InvalidContractHash);
    require!(ctx.accounts.contract.active, ObliviaError::ContractInactive);

    let multisig = &mut ctx.accounts.multisig;
    multisig.contract = ctx.accounts.contract.key();
    multisig.threshold = threshold;
    multisig.signatures_collected = 0;
    multisig.max_signers = max_signers;
    multisig.finalized = false;
    multisig.finalized_at = 0;
    multisig.bump = ctx.bumps.multisig;

    msg!("MultiSig created. Threshold: {}/{}", threshold, max_signers);
    Ok(())
}

#[derive(Accounts)]
#[instruction(contract_hash: [u8; 32], threshold: u8, max_signers: u8)]
pub struct CreateMultiSig<'info> {
    #[account(
        seeds = [CONTRACT_SEED, &contract_hash],
        bump = contract.bump
    )]
    pub contract: Account<'info, Contract>,
    #[account(
        init,
        payer = payer,
        space = MultiSigContract::LEN,
        seeds = [MULTISIG_SEED, &contract_hash],
        bump
    )]
    pub multisig: Account<'info, MultiSigContract>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}
