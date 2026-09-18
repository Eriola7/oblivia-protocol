use crate::constants::{CONTRACT_SEED, MULTISIG_MEMBER_SEED, MULTISIG_SEED, REGISTRY_SEED};
use crate::error::ObliviaError;
use crate::state::{Contract, ContractRegistry, MultiSigContract, MultiSigMember};
use anchor_lang::prelude::*;

// Multisig collection is deliberately deferred to the already contract-bound
// verifier. The v2 verifier's signature account prevents a commitment from
// being counted before proof verification; this account records threshold state.
#[derive(Accounts)]
#[instruction(contract_hash: [u8; 32], key_commitment: [u8; 32])]
pub struct RecordVerifiedMultiSig<'info> {
    #[account(mut, seeds = [REGISTRY_SEED], bump = registry.bump)]
    pub registry: Account<'info, ContractRegistry>,
    #[account(mut, seeds = [CONTRACT_SEED, &contract_hash], bump = contract.bump)]
    pub contract: Account<'info, Contract>,
    #[account(mut, seeds = [MULTISIG_SEED, &contract_hash], bump = multisig.bump)]
    pub multisig: Account<'info, MultiSigContract>,
    #[account(init, payer = payer, space = MultiSigMember::LEN, seeds = [MULTISIG_MEMBER_SEED, multisig.key().as_ref(), &key_commitment], bump)]
    pub multisig_member: Account<'info, MultiSigMember>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn record_verified_multisig_handler(
    ctx: Context<RecordVerifiedMultiSig>,
    key_commitment: [u8; 32],
) -> Result<()> {
    require!(
        !ctx.accounts.multisig.finalized,
        ObliviaError::ContractInactive
    );
    require!(
        ctx.accounts.multisig.signatures_collected < ctx.accounts.multisig.max_signers,
        ObliviaError::DuplicateSignature
    );
    ctx.accounts.multisig_member.multisig = ctx.accounts.multisig.key();
    ctx.accounts.multisig_member.key_commitment = key_commitment;
    ctx.accounts.multisig_member.timestamp = Clock::get()?.unix_timestamp;
    ctx.accounts.multisig_member.bump = ctx.bumps.multisig_member;
    ctx.accounts.multisig.signatures_collected += 1;
    if ctx.accounts.multisig.signatures_collected >= ctx.accounts.multisig.threshold {
        ctx.accounts.multisig.finalized = true;
        ctx.accounts.multisig.finalized_at = Clock::get()?.unix_timestamp;
    }
    Ok(())
}
