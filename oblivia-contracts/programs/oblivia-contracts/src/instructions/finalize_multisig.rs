use anchor_lang::prelude::*;
use crate::state::MultiSigContract;
use crate::constants::MULTISIG_SEED;
use crate::error::ObliviaError;

pub fn finalize_multisig_handler(
    ctx: Context<FinalizeMultiSig>,
    _contract_hash: [u8; 32],
) -> Result<()> {
    let multisig = &mut ctx.accounts.multisig;

    require!(!multisig.finalized, ObliviaError::ContractInactive);
    require!(
        multisig.signatures_collected >= multisig.threshold,
        ObliviaError::InvalidSignatureCommitment
    );

    multisig.finalized = true;
    multisig.finalized_at = Clock::get()?.unix_timestamp;

    msg!(
        "MultiSig finalized. {}/{} signatures collected.",
        multisig.signatures_collected,
        multisig.threshold
    );
    msg!("Identity revealed: false");
    msg!("Data transmitted: false");
    Ok(())
}

#[derive(Accounts)]
#[instruction(contract_hash: [u8; 32])]
pub struct FinalizeMultiSig<'info> {
    #[account(
        mut,
        seeds = [MULTISIG_SEED, &contract_hash],
        bump = multisig.bump
    )]
    pub multisig: Account<'info, MultiSigContract>,
}
