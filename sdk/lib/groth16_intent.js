const crypto = require('crypto');
const snarkjs = require('snarkjs');
const path = require('path');

function hashContract(text) { return crypto.createHash('sha256').update(text, 'utf8').digest(); }
function fieldBytes(value) { let n = BigInt(value), out = Buffer.alloc(32); for (let i = 31; i >= 0; i--) { out[i] = Number(n & 255n); n >>= 8n; } return out; }
async function generateIntentProof(signerKey, contractText, timestamp = Math.floor(Date.now() / 1000).toString()) {
  const hash = hashContract(contractText);
  const hex = hash.toString('hex');
  const input = { signer_key: BigInt(signerKey).toString(), timestamp, contract_hash_lo: BigInt(`0x${hex.slice(0, 32)}`).toString(), contract_hash_hi: BigInt(`0x${hex.slice(32)}`).toString() };
  const dir = path.join(__dirname, 'proving');
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, path.join(dir, 'oblivia.wasm'), path.join(dir, 'oblivia_1.zkey'));
  if (!await snarkjs.groth16.verify(require('./proving/verification_key.json'), publicSignals, proof)) throw new Error('Groth16 proof verification failed');
  const q = BigInt('21888242871839275222246405745257275088696311157297823662689037894645226208583');
  return { contractHash: Array.from(hash), proofA: Array.from(Buffer.concat([fieldBytes(proof.pi_a[0]), fieldBytes(q - BigInt(proof.pi_a[1]))])), proofB: Array.from(Buffer.concat([fieldBytes(proof.pi_b[0][1]), fieldBytes(proof.pi_b[0][0]), fieldBytes(proof.pi_b[1][1]), fieldBytes(proof.pi_b[1][0])])), proofC: Array.from(Buffer.concat([fieldBytes(proof.pi_c[0]), fieldBytes(proof.pi_c[1])])), publicInputs: Array.from(Buffer.concat(publicSignals.map(fieldBytes))), keyCommitment: Array.from(fieldBytes(publicSignals[0])), signatureCommitment: Array.from(fieldBytes(publicSignals[1])) };
}
module.exports = { hashContract, fieldBytes, generateIntentProof };
