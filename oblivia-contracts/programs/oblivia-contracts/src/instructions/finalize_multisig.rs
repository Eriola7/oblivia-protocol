use anchor_lang::prelude::*;
use crate::state::{Contract, MultiSigContract};
use crate::constants::{CONTRACT_SEED, MULTISIG_SEED};
use crate::error::ObliviaError;

pub fn finalize_multisig_handler(
    ctx: Context<FinalizeMultiSig>,
    _contract_hash: [u8; 32],
) -> Result<()> {
    let multisig = &mut ctx.accounts.multisig;
    let contract = &ctx.accounts.contract;

    require!(!multisig.finalized, ObliviaError::ContractInactive);
    require!(
        contract.signature_count >= multisig.threshold as u64,
        ObliviaError::InvalidSignatureCommitment
    );

    multisig.finalized = true;
    multisig.finalized_at = Clock::get()?.unix_timestamp;

    msg!(
        "MultiSig finalized. {}/{} signatures collected.",
        contract.signature_count,
        multisig.threshold
    );
    msg!("Identity revealed: false");
    msg!("Data transmitted: false");
    Ok(())
}

#[derive(Accounts)]
#[instruction(_contract_hash: [u8; 32])]
pub struct FinalizeMultiSig<'info> {
    #[account(
        seeds = [CONTRACT_SEED, &_contract_hash],
        bump = contract.bump
    )]
    pub contract: Account<'info, Contract>,
    #[account(
        mut,
        seeds = [MULTISIG_SEED, &_contract_hash],
        bump = multisig.bump
    )]
    pub multisig: Account<'info, MultiSigContract>,
}
