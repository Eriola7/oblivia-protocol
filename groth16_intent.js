const crypto = require('crypto');
const path = require('path');
const snarkjs = require('./zk_groth16/node_modules/snarkjs');
const { toAnchorArguments } = require('./zk_groth16/anchor_proof_format');

function hashContract(contractText) {
  return crypto.createHash('sha256').update(contractText, 'utf8').digest();
}

function hashLimbs(hash) {
  return [hash.subarray(0, 16), hash.subarray(16)].map(bytes => BigInt(`0x${bytes.toString('hex')}`).toString());
}

async function generateIntentProof(signerKey, contractText, timestamp = Math.floor(Date.now() / 1000).toString()) {
  const contractHash = hashContract(contractText);
  const [contract_hash_lo, contract_hash_hi] = hashLimbs(contractHash);
  const dir = path.join(__dirname, 'zk_groth16');
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    { signer_key: BigInt(signerKey).toString(), timestamp, contract_hash_lo, contract_hash_hi },
    path.join(dir, 'oblivia_js/oblivia.wasm'), path.join(dir, 'oblivia_1.zkey'),
  );
  const verified = await snarkjs.groth16.verify(require('./zk_groth16/verification_key.json'), publicSignals, proof);
  if (!verified) throw new Error('Groth16 proof verification failed');
  return { contractHash, publicSignals, ...toAnchorArguments(proof, publicSignals) };
}

module.exports = { hashContract, generateIntentProof };
