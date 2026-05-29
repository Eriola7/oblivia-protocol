use anchor_lang::prelude::*;
use crate::state::{ContractRegistry, Contract};
use crate::constants::{REGISTRY_SEED, CONTRACT_SEED};
use crate::error::ObliviaError;

pub fn register_contract_handler(ctx: Context<RegisterContract>, contract_hash: [u8; 32]) -> Result<()> {
    require!(contract_hash != [0u8; 32], ObliviaError::InvalidContractHash);

    let registry = &mut ctx.accounts.registry;
    let contract = &mut ctx.accounts.contract;

    contract.contract_hash = contract_hash;
    contract.timestamp = Clock::get()?.unix_timestamp;
    contract.signature_count = 0;
    contract.active = true;
    contract.bump = ctx.bumps.contract;

    registry.total_contracts += 1;

    msg!("Contract registered: {:?}", contract_hash);
    Ok(())
}

#[derive(Accounts)]
#[instruction(contract_hash: [u8; 32])]
pub struct RegisterContract<'info> {
    #[account(
        mut,
        seeds = [REGISTRY_SEED],
        bump = registry.bump
    )]
    pub registry: Account<'info, ContractRegistry>,
    #[account(
        init,
        payer = payer,
        space = Contract::LEN,
        seeds = [CONTRACT_SEED, &contract_hash],
        bump
    )]
    pub contract: Account<'info, Contract>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}
