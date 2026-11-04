// Proof generation and negative cases for the Devnet release check.
// Kept separate from the network script so the cases can be tested offline.
const path = require('node:path');
const crypto = require('node:crypto');
const snarkjs = require('snarkjs');
const { deriveSignerKey } = require('../sdk/lib/signer_key');
const { toAnchorArguments } = require('./anchor_proof_format');

const WASM = path.join(__dirname, 'oblivia_js/oblivia.wasm');
const ZKEY = path.join(__dirname, 'oblivia_1.zkey');
const VK = require('./verification_key.json');

function limbs(hash) {
  return {
    contract_hash_lo: BigInt('0x' + hash.subarray(0, 16).toString('hex')).toString(),
    contract_hash_hi: BigInt('0x' + hash.subarray(16).toString('hex')).toString(),
  };
}

// A fresh random signer secret per run, through the same derivation the SDK
// and browser clients use. There is no biometric path any more.
async function proveFor(signerSecret, hash, timestamp = Date.now().toString()) {
  const input = { signer_key: deriveSignerKey(signerSecret), timestamp, ...limbs(hash) };
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
  const locallyValid = await snarkjs.groth16.verify(VK, publicSignals, proof);
  if (!locallyValid) throw new Error('genuine proof failed local verification');
  return { proof, publicSignals, args: toAnchorArguments(proof, publicSignals) };
}

function argsFrom(proof, publicSignals) {
  return toAnchorArguments(proof, publicSignals);
}

/**
 * Build well-formed attacks. Every proof point stays a valid curve point and
 * every public input a valid field element, so a rejection must come from the
 * program's checks (contract binding or the pairing equation), not from
 * malformed bytes failing to decode.
 *
 * @param {{ a: object, b: object, replay: object }} proofs genuine proofs:
 *   a and b for this contract from two signers, replay for a different contract
 */
function negativeCases({ a, b, replay }) {
  return [
    {
      name: 'forged public input',
      detail: "signer A's genuine proof with signer B's key commitment substituted as a public input",
      expectedError: 'InvalidProof',
      rejectedBy: 'pairing check',
      proof: a.proof,
      publicSignals: [b.publicSignals[0], ...a.publicSignals.slice(1)],
    },
    {
      name: 'proof swapped between signers',
      detail: "signer A's proof points submitted with signer B's genuine public inputs",
      expectedError: 'InvalidProof',
      rejectedBy: 'pairing check',
      proof: a.proof,
      publicSignals: b.publicSignals,
    },
    {
      name: 'mixed proof points',
      detail: "signer A's proof with signer B's C point",
      expectedError: 'InvalidProof',
      rejectedBy: 'pairing check',
      proof: { ...a.proof, pi_c: b.proof.pi_c },
      publicSignals: a.publicSignals,
    },
    {
      name: 'replay from another contract',
      detail: 'a fully valid proof bound to a different contract hash',
      expectedError: 'InvalidProof',
      rejectedBy: 'contract-hash limb comparison',
      proof: replay.proof,
      publicSignals: replay.publicSignals,
    },
  ].map(c => ({ ...c, args: argsFrom(c.proof, c.publicSignals) }));
}

function randomContractHash(label) {
  return crypto.createHash('sha256').update(`${label} ${crypto.randomBytes(32).toString('hex')}`).digest();
}

module.exports = { proveFor, negativeCases, randomContractHash, VK };
