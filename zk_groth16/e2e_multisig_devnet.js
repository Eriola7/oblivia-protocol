// Devnet-only release check. Uses a dedicated test payer, never the upgrade key.
// OBLIVIA_E2E_KEYPAIR=/absolute/path/to/test-payer.json node e2e_multisig_devnet.js
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const snarkjs = require('snarkjs');
const anchor = require('@coral-xyz/anchor');
const { Connection, Keypair, PublicKey, SystemProgram, Transaction } = require('@solana/web3.js');
const { toAnchorArguments } = require('./anchor_proof_format');

async function main() {
  if (!process.env.OBLIVIA_E2E_KEYPAIR) throw new Error('Set OBLIVIA_E2E_KEYPAIR to a dedicated Devnet test payer');
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.OBLIVIA_E2E_KEYPAIR, 'utf8'))));
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), { commitment: 'confirmed' });
  const program = new anchor.Program(require('../sdk/lib/idl.json'), provider);
  const pda = (...seeds) => PublicKey.findProgramAddressSync(seeds, program.programId)[0];
  const seed = text => Buffer.from(text);
  const hash = crypto.createHash('sha256').update('Oblivia multisig release check ' + crypto.randomBytes(32).toString('hex')).digest();
  const registry = pda(seed('oblivia_registry'));
  const contract = pda(seed('oblivia_contract'), hash);
  const multisig = pda(seed('oblivia_multisig'), hash);
  const common = { registry, contract, payer: payer.publicKey, systemProgram: SystemProgram.programId };
  const register = await program.methods.registerContract([...hash]).accounts(common).instruction();
  const create = await program.methods.createMultisig([...hash], 2, 2).accounts({ ...common, multisig }).instruction();
  const setup = await provider.sendAndConfirm(new Transaction().add(register, create));

  async function countInstruction(key) {
    return program.methods.recordVerifiedMultisig([...hash], [...key]).accounts({
      ...common, multisig,
      signerRecord: pda(seed('oblivia_signer_record'), hash, key),
      multisigMember: pda(seed('oblivia_multisig_member'), multisig.toBuffer(), key),
    }).instruction();
  }
  async function expectRejected(ix, expectedLog) {
    const tx = new Transaction().add(ix);
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.sign(payer);
    const { value } = await connection.simulateTransaction(tx);
    assert.ok(value.err, 'Unauthorized/duplicate count unexpectedly accepted');
    assert.ok((value.logs || []).some(line => line.includes(expectedLog)), JSON.stringify(value));
  }
  // Only simulate against this newly created test agreement. No attack is sent.
  await expectRejected(await countInstruction(Buffer.alloc(32, 9)), 'AccountNotInitialized');
  assert.equal((await program.account.multiSigContract.fetch(multisig)).signaturesCollected, 0);

  const transactions = [];
  for (let i = 0; i < 2; i++) {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve({
      signer_key: String(12345678 + i), timestamp: Date.now().toString(),
      contract_hash_lo: BigInt('0x' + hash.subarray(0, 16).toString('hex')).toString(),
      contract_hash_hi: BigInt('0x' + hash.subarray(16).toString('hex')).toString(),
    }, path.join(__dirname, 'oblivia_js/oblivia.wasm'), path.join(__dirname, 'oblivia_1.zkey'));
    assert.equal(await snarkjs.groth16.verify(require('./verification_key.json'), publicSignals, proof), true);
    const args = toAnchorArguments(proof, publicSignals);
    const key = Buffer.from(args.keyCommitment);
    const verify = await program.methods.verifyGroth16V2(args.proofA, args.proofB, args.proofC, args.publicInputs, args.keyCommitment, args.signatureCommitment).accounts({
      ...common,
      signature: pda(seed('oblivia_signature'), contract.toBuffer(), key, Buffer.from(args.signatureCommitment)),
      signerRecord: pda(seed('oblivia_signer_record'), hash, key),
    }).instruction();
    const count = await countInstruction(key);
    transactions.push(await provider.sendAndConfirm(new Transaction().add(verify, count)));
    const state = await program.account.multiSigContract.fetch(multisig);
    assert.equal(state.signaturesCollected, i + 1);
    assert.equal(state.finalized, i === 1);
    if (i === 0) await expectRejected(count, 'already in use');
  }
  console.log(JSON.stringify({ cluster: 'devnet', program: program.programId.toBase58(), contract: contract.toBase58(), multisig: multisig.toBase58(), setup, transactions, unverifiedCountRejected: true, duplicateRejected: true, collected: 2, finalized: true }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; })
  .finally(async () => { if (globalThis.curve_bn128) await globalThis.curve_bn128.terminate(); });
