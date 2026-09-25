use crate::constants::{
    CONTRACT_SEED, MULTISIG_MEMBER_SEED, MULTISIG_SEED, REGISTRY_SEED, SIGNATURE_SEED,
    SIGNER_RECORD_SEED,
};
use crate::error::ObliviaError;
use crate::state::{
    Contract, ContractRegistry, MultiSigContract, MultiSigMember, ObliviaSignature, SignerRecord,
};
use anchor_lang::prelude::*;

// SignerRecord predates proof-gated signing and cannot establish provenance alone.
// Also require the contract-bound signature PDA: only verify_groth16_v2 can
// successfully commit a signature in this namespace. Legacy signature writers
// used seeds without the contract address and are now disabled.
#[derive(Accounts)]
#[instruction(contract_hash: [u8; 32], key_commitment: [u8; 32])]
pub struct RecordVerifiedMultiSig<'info> {
    #[account(mut, seeds = [REGISTRY_SEED], bump = registry.bump)]
    pub registry: Account<'info, ContractRegistry>,
    #[account(mut, seeds = [CONTRACT_SEED, &contract_hash], bump = contract.bump)]
    pub contract: Account<'info, Contract>,
    #[account(mut, seeds = [MULTISIG_SEED, &contract_hash], bump = multisig.bump, has_one = contract)]
    pub multisig: Account<'info, MultiSigContract>,
    #[account(
        seeds = [SIGNER_RECORD_SEED, &contract_hash, &key_commitment],
        bump = signer_record.bump,
        has_one = contract,
        constraint = signer_record.key_commitment == key_commitment @ ObliviaError::InvalidKeyCommitment
    )]
    pub signer_record: Account<'info, SignerRecord>,
    #[account(
        seeds = [SIGNATURE_SEED, contract.key().as_ref(), &key_commitment, &signature.signature_commitment],
        bump = signature.bump,
        has_one = contract,
        constraint = signature.key_commitment == key_commitment @ ObliviaError::InvalidKeyCommitment
    )]
    pub signature: Account<'info, ObliviaSignature>,
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
    require!(ctx.accounts.contract.active, ObliviaError::ContractInactive);
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
