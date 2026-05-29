use anchor_lang::prelude::*;
use crate::state::ContractRegistry;
use crate::constants::REGISTRY_SEED;

pub fn initialize_handler(ctx: Context<Initialize>) -> Result<()> {
    let registry = &mut ctx.accounts.registry;
    registry.authority = ctx.accounts.authority.key();
    registry.total_contracts = 0;
    registry.total_signatures = 0;
    registry.bump = ctx.bumps.registry;
    msg!("Oblivia registry initialized");
    Ok(())
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = ContractRegistry::LEN,
        seeds = [REGISTRY_SEED],
        bump
    )]
    pub registry: Account<'info, ContractRegistry>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}
