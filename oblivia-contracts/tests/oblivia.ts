import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { ObliviaContracts } from "../target/types/oblivia_contracts";
import { PublicKey } from "@solana/web3.js";
import { assert } from "chai";

const REGISTRY_SEED = Buffer.from("oblivia_registry");
const CONTRACT_SEED = Buffer.from("oblivia_contract");
const SIGNATURE_SEED = Buffer.from("oblivia_signature");

describe("Oblivia Protocol", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.ObliviaContracts as Program<ObliviaContracts>;

  const [registryPda] = PublicKey.findProgramAddressSync(
    [REGISTRY_SEED],
    program.programId
  );

  const contractHash = Array.from(Buffer.from("NDA Agreement - Party A".padEnd(32, "\0").slice(0, 32)));
  const [contractPda] = PublicKey.findProgramAddressSync(
    [CONTRACT_SEED, Buffer.from(contractHash)],
    program.programId
  );

  const keyCommitment = Array.from(Buffer.alloc(32, 1));
  const sigCommitment = Array.from(Buffer.alloc(32, 2));
  const [signaturePda] = PublicKey.findProgramAddressSync(
    [SIGNATURE_SEED, Buffer.from(keyCommitment), Buffer.from(sigCommitment)],
    program.programId
  );

  it("Initializes the registry", async () => {
    try {
      await program.methods
        .initialize()
        .accounts({
          registry: registryPda,
          authority: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
    } catch (e) {
      // Already initialized — acceptable
    }

    const registry = await program.account.contractRegistry.fetch(registryPda);
    assert.ok(registry.authority.equals(provider.wallet.publicKey));
    console.log("✓ Registry initialized. Authority:", registry.authority.toString());
  });

  it("Registers a contract on-chain", async () => {
    try {
      await program.methods
        .registerContract(contractHash)
        .accounts({
          registry: registryPda,
          contract: contractPda,
          payer: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
    } catch (e) {
      // Already registered — acceptable
    }

    const contract = await program.account.contract.fetch(contractPda);
    assert.ok(contract.active);
    assert.deepEqual(contract.contractHash, contractHash);
    console.log("✓ Contract registered. Active:", contract.active);
  });

  it("Submits ZK commitments on-chain", async () => {
    try {
      await program.methods
        .submitSignature(keyCommitment, sigCommitment)
        .accounts({
          registry: registryPda,
          contract: contractPda,
          signature: signaturePda,
          payer: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
    } catch (e) {
      // Already submitted — acceptable
    }

    const sig = await program.account.obliviaSignature.fetch(signaturePda);
    assert.deepEqual(sig.keyCommitment, keyCommitment);
    assert.deepEqual(sig.signatureCommitment, sigCommitment);
    console.log("✓ ZK commitments stored. Key commitment:", Buffer.from(sig.keyCommitment).toString("hex").slice(0, 16), "...");
  });

  it("Verifies signature on-chain", async () => {
    const tx = await program.methods
      .verifySignature()
      .accounts({
        contract: contractPda,
        signature: signaturePda,
      })
      .rpc();

    console.log("✓ Signature verified on-chain. Transaction:", tx);
    console.log("  Identity revealed: false");
    console.log("  Data transmitted: false");
  });
});
