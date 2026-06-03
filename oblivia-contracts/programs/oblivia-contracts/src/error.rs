use anchor_lang::prelude::*;

#[error_code]
pub enum ObliviaError {
    #[msg("Contract is no longer active")]
    ContractInactive,
    #[msg("Invalid contract hash")]
    InvalidContractHash,
    #[msg("Invalid key commitment")]
    InvalidKeyCommitment,
    #[msg("Invalid signature commitment")]
    InvalidSignatureCommitment,
    #[msg("Duplicate signature")]
    DuplicateSignature,
    #[msg("Pairing computation failed")]
    PairingFailed,
    #[msg("Invalid Groth16 proof")]
    InvalidProof,
}
