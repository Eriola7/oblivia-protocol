use anchor_lang::prelude::*;
use crate::state::{ContractRegistry, Contract, ObliviaSignature, MultiSigContract, MultiSigMember};
use crate::constants::{REGISTRY_SEED, CONTRACT_SEED, SIGNATURE_SEED, MULTISIG_SEED, MULTISIG_MEMBER_SEED};
use crate::error::ObliviaError;

pub fn submit_multisig_signature_handler(
    ctx: Context<SubmitMultiSigSignature>,
    key_commitment: [u8; 32],
    signature_commitment: [u8; 32],
) -> Result<()> {
    require!(ctx.accounts.contract.active, ObliviaError::ContractInactive);
    require!(key_commitment != [0u8; 32], ObliviaError::InvalidKeyCommitment);
    require!(signature_commitment != [0u8; 32], ObliviaError::InvalidSignatureCommitment);

    let multisig = &mut ctx.accounts.multisig;
    require!(!multisig.finalized, ObliviaError::ContractInactive);
    require!(multisig.signatures_collected < multisig.max_signers, ObliviaError::DuplicateSignature);

    // Record member PDA — init fails if same key_commitment signs twice
    let member = &mut ctx.accounts.multisig_member;
    member.multisig = multisig.key();
    member.key_commitment = key_commitment;
    member.timestamp = Clock::get()?.unix_timestamp;
    member.bump = ctx.bumps.multisig_member;

    // Record the signature
    let signature = &mut ctx.accounts.signature;
    signature.key_commitment = key_commitment;
    signature.signature_commitment = signature_commitment;
    signature.contract = ctx.accounts.contract.key();
    signature.timestamp = Clock::get()?.unix_timestamp;
    signature.bump = ctx.bumps.signature;

    let contract = &mut ctx.accounts.contract;
    contract.signature_count += 1;

    let registry = &mut ctx.accounts.registry;
    registry.total_signatures += 1;

    multisig.signatures_collected += 1;

    // Auto-finalize if threshold reached
    if multisig.signatures_collected >= multisig.threshold {
        multisig.finalized = true;
        multisig.finalized_at = Clock::get()?.unix_timestamp;
        msg!("MultiSig threshold reached. Contract finalized anonymously.");
    }

    msg!("MultiSig signature submitted {}/{}. Key: {:?}",
        multisig.signatures_collected, multisig.threshold, &key_commitment[..8]);
    Ok(())
}

#[derive(Accounts)]
#[instruction(key_commitment: [u8; 32], signature_commitment: [u8; 32])]
pub struct SubmitMultiSigSignature<'info> {
    #[account(mut, seeds = [REGISTRY_SEED], bump = registry.bump)]
    pub registry: Account<'info, ContractRegistry>,
    #[account(mut, seeds = [CONTRACT_SEED, &contract.contract_hash], bump = contract.bump)]
    pub contract: Account<'info, Contract>,
    #[account(
        init, payer = payer, space = ObliviaSignature::LEN,
        seeds = [SIGNATURE_SEED, &key_commitment, &signature_commitment], bump
    )]
    pub signature: Account<'info, ObliviaSignature>,
    #[account(mut, seeds = [MULTISIG_SEED, &contract.contract_hash], bump = multisig.bump)]
    pub multisig: Account<'info, MultiSigContract>,
    /// Deduplication PDA — init fails if same signer submits twice
    #[account(
        init, payer = payer, space = MultiSigMember::LEN,
        seeds = [MULTISIG_MEMBER_SEED, multisig.key().as_ref(), &key_commitment], bump
    )]
    pub multisig_member: Account<'info, MultiSigMember>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}
