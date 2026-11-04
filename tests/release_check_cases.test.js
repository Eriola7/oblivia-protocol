const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const snarkjs = require('../zk_groth16/node_modules/snarkjs');
const { proveFor, negativeCases, randomContractHash, VK } = require('../zk_groth16/release_check_cases');

const R = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');

// Mirrors verify_groth16_v2's checks that run before the pairing equation.
function passesProgramPrechecks(args, hash) {
  const inputs = Buffer.from(args.publicInputs);
  const low = Buffer.concat([Buffer.alloc(16), hash.subarray(0, 16)]);
  const high = Buffer.concat([Buffer.alloc(16), hash.subarray(16)]);
  return inputs.subarray(64, 96).equals(low) && inputs.subarray(96, 128).equals(high) &&
    inputs.subarray(0, 32).equals(Buffer.from(args.keyCommitment)) &&
    inputs.subarray(32, 64).equals(Buffer.from(args.signatureCommitment));
}

test('release-check attacks are well-formed but invalid, and fail at the intended check', { timeout: 120000 }, async () => {
    try {
        const hash = randomContractHash('test');
        const otherHash = randomContractHash('other');
        const secretA = crypto.randomBytes(32);
        // Sequential: concurrent first use makes snarkjs start duplicate worker pools.
        const a = await proveFor(secretA, hash);
        const b = await proveFor(crypto.randomBytes(32), hash);
        const replay = await proveFor(crypto.randomBytes(32), otherHash);
        const aAgain = await proveFor(secretA, hash);
        assert.notEqual(a.publicSignals[0], b.publicSignals[0], 'random signers produce different keys');
        assert.equal(a.publicSignals[0], aAgain.publicSignals[0], 'the same secret derives the same key');
        assert.ok(passesProgramPrechecks(a.args, hash), 'genuine proof passes the binding checks');

        const cases = negativeCases({ a, b, replay });
        assert.equal(cases.length, 4);
        for (const c of cases) {
            for (const signal of c.publicSignals) assert.ok(BigInt(signal) < R, `${c.name}: public input is a valid field element`);
            const valid = await snarkjs.groth16.verify(VK, c.publicSignals, c.proof);
            if (c.rejectedBy === 'pairing check') {
                assert.equal(valid, false, `${c.name}: must not verify`);
                assert.ok(passesProgramPrechecks(c.args, hash), `${c.name}: must reach the pairing check, not fail earlier`);
            } else {
                assert.equal(valid, true, `${c.name}: is a genuine proof, for another contract`);
                assert.equal(passesProgramPrechecks(c.args, hash), false, `${c.name}: must fail the contract-hash comparison`);
            }
        }
    } finally {
        if (globalThis.curve_bn128) await globalThis.curve_bn128.terminate();
    }
});

test('the release check reports observed results, not hard-coded success flags', () => {
    const source = require('node:fs').readFileSync(require.resolve('../zk_groth16/e2e_multisig_devnet.js'), 'utf8');
    assert.doesNotMatch(source, /Rejected:\s*true|finalized:\s*true|collected:\s*2\b/);
    assert.doesNotMatch(source, /12345678/);
    assert.match(source, /allPassed = checks\.every/);
});
