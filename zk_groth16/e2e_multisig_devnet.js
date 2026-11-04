// Devnet release smoke test. Uses a dedicated test payer, never the upgrade key.
// OBLIVIA_E2E_KEYPAIR=/absolute/path/to/test-payer.json node e2e_multisig_devnet.js
//
// Scope: confirms the deployed program accepts genuine proofs, rejects a set of
// well-formed forged/replayed proofs, and counts a 2-of-2 agreement correctly.
// It is not a security audit or exhaustive adversarial test. Every reported
// result is an observed value; nothing in the output is a hard-coded claim.
const fs = require('node:fs');
const crypto = require('node:crypto');
const anchor = require('@coral-xyz/anchor');
const { Connection, Keypair, PublicKey, SystemProgram, Transaction } = require('@solana/web3.js');
const { proveFor, negativeCases, randomContractHash } = require('./release_check_cases');

async function main() {
  if (!process.env.OBLIVIA_E2E_KEYPAIR) throw new Error('Set OBLIVIA_E2E_KEYPAIR to a dedicated Devnet test payer');
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.OBLIVIA_E2E_KEYPAIR, 'utf8'))));
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), { commitment: 'confirmed' });
  const program = new anchor.Program(require('../sdk/lib/idl.json'), provider);
  const pda = (...seeds) => PublicKey.findProgramAddressSync(seeds, program.programId)[0];
  const seed = text => Buffer.from(text);

  // Fresh contract and fresh random signers on every run.
  const hash = randomContractHash('Oblivia multisig release check');
  const otherHash = randomContractHash('Oblivia replay source');
  const secrets = [crypto.randomBytes(32), crypto.randomBytes(32)];
  // Sequential: concurrent first use makes snarkjs start duplicate worker pools.
  const genuineA = await proveFor(secrets[0], hash);
  const genuineB = await proveFor(secrets[1], hash);
  const replay = await proveFor(crypto.randomBytes(32), otherHash);

  const registry = pda(seed('oblivia_registry'));
  const contract = pda(seed('oblivia_contract'), hash);
  const multisig = pda(seed('oblivia_multisig'), hash, Buffer.from([2]), Buffer.from([2])); // threshold 2, max signers 2
  const common = { registry, contract, payer: payer.publicKey, systemProgram: SystemProgram.programId };
  const register = await program.methods.registerContract([...hash]).accounts(common).instruction();
  const create = await program.methods.createMultisig([...hash], 2, 2).accounts({ ...common, multisig }).instruction();
  const setup = await provider.sendAndConfirm(new Transaction().add(register, create));

  const signaturePda = (key, sig) => pda(seed('oblivia_signature'), contract.toBuffer(), Buffer.from(key), Buffer.from(sig));
  const recordPda = key => pda(seed('oblivia_signer_record'), hash, Buffer.from(key));

  async function verifyInstruction(args) {
    return program.methods.verifyGroth16V2(args.proofA, args.proofB, args.proofC, args.publicInputs, args.keyCommitment, args.signatureCommitment)
      .accounts({ ...common, signature: signaturePda(args.keyCommitment, args.signatureCommitment), signerRecord: recordPda(args.keyCommitment) })
      .instruction();
  }
  async function countInstruction(key, signatureCommitment) {
    return program.methods.recordVerifiedMultisig([...hash], [...key]).accounts({
      ...common, multisig,
      signerRecord: recordPda(key),
      signature: signaturePda(key, signatureCommitment),
      multisigMember: pda(seed('oblivia_multisig_member'), multisig.toBuffer(), Buffer.from(key)),
    }).instruction();
  }
  async function simulate(instructions) {
    const tx = new Transaction().add(...instructions);
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.sign(payer);
    const { value } = await connection.simulateTransaction(tx);
    return { err: value.err, logs: value.logs || [] };
  }

  const checks = [];
  async function expectRejected(name, detail, instructions, expectedLog, rejectedBy) {
    const { err, logs } = await simulate(instructions);
    const matchedLog = logs.find(line => line.includes(expectedLog)) || null;
    checks.push({ check: name, detail, expected: `rejected with ${expectedLog} (${rejectedBy})`, rejected: Boolean(err), matchedLog, passed: Boolean(err) && matchedLog !== null });
  }
  async function stateNow() {
    const s = await program.account.multiSigContract.fetch(multisig);
    return { collected: s.signaturesCollected, threshold: s.threshold, finalized: s.finalized };
  }

  // Simulations only, against this new test agreement. No attack is sent.
  for (const attack of negativeCases({ a: genuineA, b: genuineB, replay })) {
    const ixs = [await verifyInstruction(attack.args), await countInstruction(attack.args.keyCommitment, attack.args.signatureCommitment)];
    await expectRejected(attack.name, attack.detail, ixs, attack.expectedError, attack.rejectedBy);
  }
  await expectRejected('count without verification',
    'No proof submitted. Shows the counting gate requires a verified record; it does not test proof validity.',
    [await countInstruction(Buffer.alloc(32, 9), Buffer.alloc(32, 8))], 'AccountNotInitialized', 'missing signer record');

  const afterAttacks = await stateNow();
  checks.push({ check: 'no state change from rejected attempts', detail: 'collected count still 0 after all simulations', observed: afterAttacks, passed: afterAttacks.collected === 0 && !afterAttacks.finalized });

  const transactions = [];
  for (const [i, genuine] of [genuineA, genuineB].entries()) {
    const key = Buffer.from(genuine.args.keyCommitment);
    const count = await countInstruction(key, Buffer.from(genuine.args.signatureCommitment));
    transactions.push(await provider.sendAndConfirm(new Transaction().add(await verifyInstruction(genuine.args), count)));
    const observed = await stateNow();
    checks.push({ check: `genuine signer ${i + 1} counted`, observed, passed: observed.collected === i + 1 && observed.finalized === (i === 1) });
    if (i === 0) await expectRejected('duplicate count', 'the same verified key counted a second time', [count], 'already in use', 'multisig member PDA');
  }

  const leaked = [];
  for (const attack of negativeCases({ a: genuineA, b: genuineB, replay })) {
    const forged = attack.args;
    const sameAsGenuine = [genuineA, genuineB].some(g =>
      Buffer.from(g.args.keyCommitment).equals(Buffer.from(forged.keyCommitment)) &&
      Buffer.from(g.args.signatureCommitment).equals(Buffer.from(forged.signatureCommitment)));
    if (sameAsGenuine) continue; // e.g. the swap case reuses B's genuine commitments, which B then legitimately recorded
    if (await connection.getAccountInfo(signaturePda(forged.keyCommitment, forged.signatureCommitment))) leaked.push(attack.name);
  }
  checks.push({ check: 'no receipt exists for any forged commitment', observed: { receiptsFound: leaked }, passed: leaked.length === 0 });

  const allPassed = checks.every(c => c.passed);
  console.log(JSON.stringify({
    scope: 'Devnet smoke test: genuine flow plus simulated well-formed forgeries. Not a security audit.',
    cluster: 'devnet', program: program.programId.toBase58(), contract: contract.toBase58(), multisig: multisig.toBase58(),
    setup, transactions, checks, finalState: await stateNow(), allPassed,
  }, null, 2));
  if (!allPassed) process.exitCode = 1;
}

main().catch(error => { console.error(error.message); process.exitCode = 1; })
  .finally(async () => { if (globalThis.curve_bn128) await globalThis.curve_bn128.terminate(); });
