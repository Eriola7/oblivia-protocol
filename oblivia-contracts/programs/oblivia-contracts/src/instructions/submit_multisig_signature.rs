use crate::constants::{
    CONTRACT_SEED, MULTISIG_MEMBER_SEED, MULTISIG_SEED, REGISTRY_SEED, SIGNATURE_SEED,
};
use crate::error::ObliviaError;
use crate::state::{
    Contract, ContractRegistry, MultiSigContract, MultiSigMember, ObliviaSignature,
};
use anchor_lang::prelude::*;

pub fn submit_multisig_signature_handler(
    _ctx: Context<SubmitMultiSigSignature>,
    _key_commitment: [u8; 32],
    _signature_commitment: [u8; 32],
) -> Result<()> {
    // See submit_signature_handler: multisig must use the same atomic,
    // contract-bound proof verification before it can collect signatures.
    err!(ObliviaError::ProofBindingUnavailable)
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
        seeds = [SIGNATURE_SEED, contract.key().as_ref(), &key_commitment, &signature_commitment], bump
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
