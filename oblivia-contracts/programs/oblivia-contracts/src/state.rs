use anchor_lang::prelude::*;

#[account]
pub struct ContractRegistry {
    pub authority: Pubkey,
    pub total_contracts: u64,
    pub total_signatures: u64,
    pub bump: u8,
}

impl ContractRegistry {
    pub const LEN: usize = 8 + 32 + 8 + 8 + 1;
}

#[account]
pub struct Contract {
    pub contract_hash: [u8; 32],
    pub timestamp: i64,
    pub signature_count: u64,
    pub active: bool,
    pub bump: u8,
}

impl Contract {
    pub const LEN: usize = 8 + 32 + 8 + 8 + 1 + 1;
}

#[account]
pub struct ObliviaSignature {
    pub key_commitment: [u8; 32],
    pub signature_commitment: [u8; 32],
    pub contract: Pubkey,
    pub timestamp: i64,
    pub bump: u8,
}

impl ObliviaSignature {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 8 + 1;
}
