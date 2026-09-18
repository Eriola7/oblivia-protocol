// Converts snarkjs Groth16 output to the byte layout expected by Oblivia v2.
const Q = BigInt('21888242871839275222246405745257275088696311157297823662689037894645226208583');

function field(value) {
  let n = BigInt(value);
  const out = Buffer.alloc(32);
  for (let i = 31; i >= 0; i--) { out[i] = Number(n & 0xffn); n >>= 8n; }
  return out;
}

function toAnchorArguments(proof, publicSignals) {
  if (!Array.isArray(publicSignals) || publicSignals.length !== 4) throw new Error('Expected four public signals');
  const aX = field(proof.pi_a[0]);
  const aY = field(proof.pi_a[1]);
  const negAY = field(Q - BigInt(`0x${aY.toString('hex')}`));
  return {
    proofA: Array.from(Buffer.concat([aX, negAY])),
    proofB: Array.from(Buffer.concat([field(proof.pi_b[0][1]), field(proof.pi_b[0][0]), field(proof.pi_b[1][1]), field(proof.pi_b[1][0])])),
    proofC: Array.from(Buffer.concat([field(proof.pi_c[0]), field(proof.pi_c[1])])),
    publicInputs: Array.from(Buffer.concat(publicSignals.map(field))),
    keyCommitment: Array.from(field(publicSignals[0])),
    signatureCommitment: Array.from(field(publicSignals[1])),
  };
}

module.exports = { toAnchorArguments };
