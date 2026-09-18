use crate::constants::{CONTRACT_SEED, REGISTRY_SEED, SIGNATURE_SEED, SIGNER_RECORD_SEED};
use crate::error::ObliviaError;
use crate::state::{Contract, ContractRegistry, ObliviaSignature, SignerRecord};
use anchor_lang::prelude::*;
use groth16_solana::groth16::{Groth16Verifier, Groth16Verifyingkey};

include!(concat!(env!("OUT_DIR"), "/vk_generated.rs"));

const VERIFYING_KEY: Groth16Verifyingkey = Groth16Verifyingkey {
    nr_pubinputs: 4,
    vk_alpha_g1: VK_ALPHA_G1,
    vk_beta_g2: VK_BETA_G2,
    vk_gamme_g2: VK_GAMMA_G2,
    vk_delta_g2: VK_DELTA_G2,
    vk_ic: &IC,
};

fn contract_hash_limbs(hash: [u8; 32]) -> ([u8; 32], [u8; 32]) {
    let mut low = [0u8; 32];
    let mut high = [0u8; 32];
    low[16..].copy_from_slice(&hash[..16]);
    high[16..].copy_from_slice(&hash[16..]);
    (low, high)
}

pub fn verify_groth16_v2_handler(
    ctx: Context<VerifyGroth16V2>,
    proof_a_neg: [u8; 64],
    proof_b: [u8; 128],
    proof_c: [u8; 64],
    pub_inputs: [u8; 128],
    key_commitment: [u8; 32],
    signature_commitment: [u8; 32],
) -> Result<()> {
    let inputs: [[u8; 32]; 4] =
        core::array::from_fn(|i| pub_inputs[i * 32..(i + 1) * 32].try_into().unwrap());
    let (low, high) = contract_hash_limbs(ctx.accounts.contract.contract_hash);
    require!(
        inputs[2] == low && inputs[3] == high,
        ObliviaError::InvalidProof
    );
    require!(
        inputs[0] == key_commitment && inputs[1] == signature_commitment,
        ObliviaError::InvalidProof
    );
    let mut verifier =
        Groth16Verifier::new(&proof_a_neg, &proof_b, &proof_c, &inputs, &VERIFYING_KEY)
            .map_err(|_| error!(ObliviaError::InvalidProof))?;
    verifier
        .verify()
        .map_err(|_| error!(ObliviaError::InvalidProof))?;
    let now = Clock::get()?.unix_timestamp;
    ctx.accounts.signature.key_commitment = key_commitment;
    ctx.accounts.signature.signature_commitment = signature_commitment;
    ctx.accounts.signature.contract = ctx.accounts.contract.key();
    ctx.accounts.signature.timestamp = now;
    ctx.accounts.signature.bump = ctx.bumps.signature;
    ctx.accounts.signer_record.contract = ctx.accounts.contract.key();
    ctx.accounts.signer_record.key_commitment = key_commitment;
    ctx.accounts.signer_record.timestamp = now;
    ctx.accounts.signer_record.bump = ctx.bumps.signer_record;
    ctx.accounts.contract.signature_count += 1;
    ctx.accounts.registry.total_signatures += 1;
    msg!("Contract-bound Groth16 proof verified.");
    Ok(())
}

#[derive(Accounts)]
#[instruction(
    proof_a_neg: [u8; 64],
    proof_b: [u8; 128],
    proof_c: [u8; 64],
    pub_inputs: [u8; 128],
    key_commitment: [u8; 32],
    signature_commitment: [u8; 32]
)]
pub struct VerifyGroth16V2<'info> {
    #[account(mut, seeds = [REGISTRY_SEED], bump = registry.bump)]
    pub registry: Account<'info, ContractRegistry>,
    #[account(mut, seeds = [CONTRACT_SEED, &contract.contract_hash], bump = contract.bump)]
    pub contract: Account<'info, Contract>,
    #[account(init, payer = payer, space = ObliviaSignature::LEN, seeds = [SIGNATURE_SEED, contract.key().as_ref(), &key_commitment, &signature_commitment], bump)]
    pub signature: Account<'info, ObliviaSignature>,
    #[account(init, payer = payer, space = SignerRecord::LEN, seeds = [SIGNER_RECORD_SEED, &contract.contract_hash, &key_commitment], bump)]
    pub signer_record: Account<'info, SignerRecord>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}
