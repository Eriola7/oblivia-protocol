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

/// Multi-signature contract account
/// Enables M-of-N anonymous signing — any threshold of parties
/// can co-sign without any party revealing their identity
#[account]
pub struct MultiSigContract {
    /// The underlying contract being multi-signed
    pub contract: Pubkey,
    /// Number of signatures required to finalize
    pub threshold: u8,
    /// Current number of signatures collected
    pub signatures_collected: u8,
    /// Maximum signers allowed
    pub max_signers: u8,
    /// Whether threshold has been reached and contract is finalized
    pub finalized: bool,
    /// Timestamp when finalized
    pub finalized_at: i64,
    pub bump: u8,
}

impl MultiSigContract {
    pub const LEN: usize = 8   // discriminator
        + 32  // contract
        + 1   // threshold
        + 1   // signatures_collected
        + 1   // max_signers
        + 1   // finalized
        + 8   // finalized_at
        + 1;  // bump
}
