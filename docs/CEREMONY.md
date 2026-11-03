# Production trusted setup

The Groth16 proving and verification keys in this repository (`zk_groth16/oblivia_1.zkey`, `zk_groth16/verification_key.json` and their copies in `sdk/lib/proving/`) are **development artifacts**. They were produced by a single local contribution, so whoever ran that setup could in principle forge proofs. They are acceptable for Devnet testing and nothing else.

This document is the plan for replacing them. The ceremony and the independent audit (see [AUDIT_SCOPE.md](AUDIT_SCOPE.md)) are funded milestones, not completed work.

## Why a ceremony is needed

Groth16 needs a circuit-specific setup (phase 2) on top of a universal Powers of Tau (phase 1). Soundness holds as long as **at least one** phase-2 contributor destroys their randomness. A public, multi-party ceremony makes that assumption credible.

## Circuit facts

| Item | Value |
| --- | --- |
| Circuit | `zk_groth16/oblivia.circom` |
| Constraints | 1,153 (fits in 2^12) |
| Public signals | 4 (key commitment, signature commitment, two contract-hash limbs) |
| Curve | BN254 (`alt_bn128` syscalls on Solana) |

## Phase 1: public Powers of Tau

Use the public Hermez/Polygon Powers of Tau file for 2^12 constraints (`powersOfTau28_hez_final_12.ptau`, linked from the snarkjs README) instead of the local `pot12_final.ptau`. Before use:

1. Download it into `zk_groth16/ceremony/`.
2. `ceremony.sh init` runs `snarkjs powersoftau verify` and saves the output to `ceremony/out/phase1_verification.txt`.
3. Compare the reported contribution hashes with the publicly listed ones. Do not continue on a mismatch.

## Phase 2: circuit-specific contributions

All steps use `zk_groth16/ceremony/ceremony.sh`. A full local dry run with test entropy has been executed successfully against the current circuit.

1. **Freeze the circuit.** Tag the commit that contains the final `oblivia.circom` and `oblivia.r1cs`. Any circuit change after this point restarts the ceremony.
2. **Announce.** Publish the schedule, the r1cs hash (`ceremony/out/init.sha256`) and the beacon source and round chosen in advance (for example a future drand round number).
3. **Initialize.** `./ceremony/ceremony.sh init`
4. **Contribute.** Each participant, in turn, downloads the latest zkey, runs `./ceremony/ceremony.sh contribute "<name>"`, enters their own random text, and publishes the new zkey plus the printed contribution hash. Target at least 5 independent contributors, including people outside the team.
5. **Verify.** After each contribution anyone can run `./ceremony/ceremony.sh verify`; it lists every contribution hash in order.
6. **Beacon.** When the announced public randomness is available: `./ceremony/ceremony.sh beacon <hex> 10`.
7. **Export.** `./ceremony/ceremony.sh export` verifies the final zkey and installs it under the existing file names for the circuit directory, SDK and relay.
8. **Redeploy.** Rebuild the program (its `build.rs` embeds `zk_groth16/verification_key.json`), run the full test suite, upgrade the Devnet program, then publish a new SDK version. Old proofs stop verifying after the upgrade; signatures already recorded on-chain stay valid.

## Transparency record

Publish the following alongside the release:

- phase-1 verification output
- every intermediate zkey and contribution hash
- the beacon value, its source and round
- `final_verification.txt` and `final.sha256`
- the commit hash of the frozen circuit

## Ordering with the audit

Audit the circuit first, then run the ceremony on the audited circuit. A circuit fix found after the ceremony means running it again.
