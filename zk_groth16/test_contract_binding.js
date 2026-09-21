const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const snarkjs = require('snarkjs');
const path = require('node:path');
const { toAnchorArguments } = require('./anchor_proof_format');

function limbs(text) {
  const hash = crypto.createHash('sha256').update(text, 'utf8').digest();
  return [hash.subarray(0, 16), hash.subarray(16)].map(bytes => BigInt(`0x${bytes.toString('hex')}`).toString());
}

async function prove(contract) {
  const [contract_hash_lo, contract_hash_hi] = limbs(contract);
  const dir = __dirname;
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    { signer_key: '12345678', timestamp: '1000000000', contract_hash_lo, contract_hash_hi },
    path.join(dir, 'oblivia_js/oblivia.wasm'), path.join(dir, 'oblivia_1.zkey'),
  );
  const verified = await snarkjs.groth16.verify(require('./verification_key.json'), publicSignals, proof);
  assert.equal(verified, true);
  assert.equal(publicSignals[2], contract_hash_lo);
  assert.equal(publicSignals[3], contract_hash_hi);
  const anchor = toAnchorArguments(proof, publicSignals);
  assert.equal(anchor.proofA.length, 64);
  assert.equal(anchor.proofB.length, 128);
  assert.equal(anchor.proofC.length, 64);
  assert.equal(anchor.publicInputs.length, 128);
  assert.deepEqual(anchor.keyCommitment, anchor.publicInputs.slice(0, 32));
  return publicSignals;
}

(async () => {
  const first = await prove('Oblivia contract A');
  const second = await prove('Oblivia contract B');
  assert.notDeepEqual(first.slice(2), second.slice(2));
  // Mirrors the Anchor v2 contract-limb gate: a valid proof for A cannot be
  // attached to Contract B merely because its pairing check succeeds.
  assert.notEqual(first[2], second[2]);
  assert.notEqual(first[3], second[3]);
  console.log('PASS: verified proofs are publicly bound to distinct full contract hashes');
})().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(async () => {
    // ffjavascript caches its worker pool; release it so CI exits after tests.
    if (globalThis.curve_bn128) await globalThis.curve_bn128.terminate();
  });
