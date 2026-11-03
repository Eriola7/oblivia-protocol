const { sha256 } = require('@noble/hashes/sha2.js');
const snarkjs = require('snarkjs');
const { deriveSignerKey } = require('../../sdk/lib/signer_key');
const { createSignerPasskey, getPasskeySecret } = require('../../sdk/lib/passkey');
const RELAY_URL = 'https://oblivia-relay.onrender.com';
const FIELD_MODULUS = BigInt('21888242871839275222246405745257275088696311157297823662689037894645226208583');

function fieldBytes(value) {
    let n = BigInt(value); const out = new Uint8Array(32);
    for (let i = 31; i >= 0; i--) { out[i] = Number(n & 255n); n >>= 8n; }
    return out;
}

function contractHashLimbs(hash) {
    const hex = Array.from(hash).map(b => b.toString(16).padStart(2, '0')).join('');
    return [BigInt('0x' + hex.slice(0, 32)).toString(), BigInt('0x' + hex.slice(32)).toString()];
}

function anchorProof(proof, signals) {
    const aY = BigInt(proof.pi_a[1]);
    return {
        proofA: Array.from([...fieldBytes(proof.pi_a[0]), ...fieldBytes(FIELD_MODULUS - aY)]),
        proofB: Array.from([...fieldBytes(proof.pi_b[0][1]), ...fieldBytes(proof.pi_b[0][0]), ...fieldBytes(proof.pi_b[1][1]), ...fieldBytes(proof.pi_b[1][0])]),
        proofC: Array.from([...fieldBytes(proof.pi_c[0]), ...fieldBytes(proof.pi_c[1])]),
        // Uint8Array values are not flattened by Array.prototype.flatMap.
        // Expand each 32-byte field explicitly for Anchor's [u8; 128] input.
        publicInputs: signals.flatMap(signal => Array.from(fieldBytes(signal))),
        keyCommitment: Array.from(fieldBytes(signals[0])),
        signatureCommitment: Array.from(fieldBytes(signals[1])),
    };
}

// Face ID / Touch ID only unlocks a standard passkey; its PRF output is the
// signer secret. Oblivia stores nothing; the platform keychain handles backup.
let signerUnlocked = false;
let signerSecret = null;
let unlockInProgress = false;
let signingInProgress = false;
// Session-only confirmed receipts: never retain a signing scalar or secret.
const confirmedReceipts = new Map();
let confirmedSignerReceipt = null;

function clearSigner() {
    if (signerSecret) signerSecret.fill(0);
    signerSecret = null;
    signerUnlocked = false;
}

function showConfirmedReceipt(receipt) {
    document.getElementById('signedContractDisplay').textContent = receipt.contract;
    document.getElementById('proofDisplay').textContent = receipt.proofPreview;
    document.getElementById('contractSignedDisplay').textContent = 'TRUE';
    const txDisplay = document.getElementById('txDisplay');
    const link = document.createElement('a');
    link.href = 'https://explorer.solana.com/tx/' + receipt.transaction + '?cluster=devnet';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = receipt.transaction.slice(0, 20) + '...';
    txDisplay.textContent = 'Verified on-chain: ';
    txDisplay.appendChild(link);
    document.getElementById('result').classList.add('show');
}

window.addEventListener('DOMContentLoaded', () => {
    document.getElementById('contract').addEventListener('input', () => {
        if (signingInProgress) return;
        const alreadySigned = confirmedSignerReceipt &&
            confirmedSignerReceipt.contract === document.getElementById('contract').value;
        document.getElementById('signBtn').disabled = Boolean(alreadySigned) || !signerUnlocked || unlockInProgress;
        if (alreadySigned) {
            showConfirmedReceipt(confirmedSignerReceipt);
            return;
        }
        document.getElementById('result').classList.remove('show');
        document.getElementById('contractSignedDisplay').textContent = 'PENDING';
        document.getElementById('txDisplay').textContent = 'not submitted for this text';
        document.getElementById('proofDisplay').textContent = 'not generated';
        document.getElementById('log').innerHTML = '';
    });
});

function log(message, type = 'step') {
    const logEl = document.getElementById('log');
    const line = document.createElement('div');
    line.className = type;
    line.textContent = '> ' + message;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
}

window.unlockSigner = async function(create = false) {
    if (unlockInProgress || signingInProgress) return;
    unlockInProgress = true;
    // A different passkey derives a different key. Compare its public commitment
    // against earlier receipts after proving, without persisting the secret.
    confirmedSignerReceipt = null;
    const box = document.getElementById('passkeyBox');
    const status = document.getElementById('passkeyStatus');
    const icon = document.getElementById('passkeyIcon');
    document.getElementById('signBtn').disabled = true;
    clearSigner();
    box.classList.remove('active');

    try {
        if (create) {
            status.textContent = 'Creating passkey...';
            await createSignerPasskey({ rpName: 'Oblivia', userName: 'Oblivia signer' });
            log('Passkey created — backed up by your platform keychain', 'success');
        }
        status.textContent = 'Confirm with Face ID, Touch ID or device PIN...';
        icon.textContent = '◎';
        signerSecret = await getPasskeySecret();
        signerUnlocked = true;

        box.classList.add('active');
        status.textContent = 'Passkey unlocked. Signer ready.';
        icon.textContent = '◉';
        document.getElementById('signBtn').disabled = false;
        log('Passkey unlocked on-device — signer secret never transmitted', 'success');
    } catch (e) {
        clearSigner();
        log('Error: ' + e.message);
        status.textContent = 'Passkey unavailable. Try again or create a passkey.';
        icon.textContent = '◉';
    } finally {
        unlockInProgress = false;
    }
};

window.createPasskey = function() {
    return window.unlockSigner(true);
};

window.signContract = async function() {
    if (signingInProgress || unlockInProgress) return;
    const contractInput = document.getElementById('contract');
    const contract = contractInput.value;
    if (!contract) { log('Please enter contract text'); return; }
    if (!signerUnlocked) { log('Please unlock your passkey first'); return; }
    if (confirmedSignerReceipt && confirmedSignerReceipt.contract === contract) {
        showConfirmedReceipt(confirmedSignerReceipt);
        document.getElementById('signBtn').disabled = true;
        log('Already signed with this passkey — keeping the confirmed receipt.', 'success');
        return;
    }

    signingInProgress = true;
    contractInput.disabled = true;
    document.getElementById('signBtn').disabled = true;
    document.getElementById('log').innerHTML = '';
    document.getElementById('result').classList.remove('show');
    document.getElementById('contractSignedDisplay').textContent = 'PENDING';
    document.getElementById('txDisplay').textContent = 'pending...';
    document.getElementById('proofDisplay').textContent = 'not generated';
    // Keep the exact signed text with its receipt, independent of the editor.
    document.getElementById('signedContractDisplay').textContent = contract;

    let stage = 'preparation';
    let signingKey;
    let input;
    try {
        log('Deriving signing key from passkey secret...');
        signingKey = deriveSignerKey(signerSecret);
        log('Signing key derived — kept only in memory');

        log('Hashing contract...');
        const contractBytes = new TextEncoder().encode(contract);
        const contractHash = Array.from(sha256(contractBytes)).slice(0, 32);
        log('Contract hash computed');

        stage = 'proof generation';
        log('Generating ZK proof... (this takes a moment)');
        const [contract_hash_lo, contract_hash_hi] = contractHashLimbs(contractHash);
        input = {
            contract_hash_lo, contract_hash_hi,
            signer_key: signingKey,
            timestamp: Date.now().toString()
        };
        const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, RELAY_URL + '/proving-assets/oblivia_js/oblivia.wasm', RELAY_URL + '/proving-assets/oblivia_1.zkey');
        const payload = anchorProof(proof, publicSignals);
        log('Proof generated — awaiting on-chain verification', 'success');
        const proofPreview = payload.proofA.slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('') + '...';
        document.getElementById('proofDisplay').textContent = proofPreview;

        const keyCommitment = '0x' + Buffer.from(payload.keyCommitment).toString('hex');
        const signatureCommitment = '0x' + Buffer.from(payload.signatureCommitment).toString('hex');
        const receiptKey = Buffer.from(contractHash).toString('hex') + ':' + keyCommitment;
        const existingReceipt = confirmedReceipts.get(receiptKey);
        if (existingReceipt) {
            confirmedSignerReceipt = existingReceipt;
            showConfirmedReceipt(existingReceipt);
            log('This signing key already signed this agreement — keeping the confirmed receipt.', 'success');
            return;
        }

        stage = 'submission';
        log('Submitting to Solana for verification... (sponsored — free to you)');
        const response = await fetch(RELAY_URL + '/sign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contractHash: Array.from(contractHash),
                keyCommitment,
                signatureCommitment,
                proofA: payload.proofA, proofB: payload.proofB, proofC: payload.proofC, publicInputs: payload.publicInputs
            })
        });
        const data = await response.json();
        if (!response.ok || !data || data.error) {
            throw new Error(data && data.error ? data.error : 'Relay returned an unsuccessful response');
        }
        if (typeof data.transaction !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(data.transaction)) {
            throw new Error('Relay did not return a valid transaction signature');
        }
        confirmedSignerReceipt = { contract, transaction: data.transaction, proofPreview };
        confirmedReceipts.set(receiptKey, confirmedSignerReceipt);
        showConfirmedReceipt(confirmedSignerReceipt);
        log('Signed on-chain — identity concealed', 'success');
        document.getElementById('contractSignedDisplay').textContent = 'TRUE';
        log('Done. Identity: concealed. Proof: on-chain.', 'success');
    } catch (e) {
        log('Failed during ' + stage + ': ' + e.message);
        const submitted = stage === 'submission';
        document.getElementById('contractSignedDisplay').textContent = submitted ? 'UNCONFIRMED' : 'FALSE';
        document.getElementById('txDisplay').textContent = submitted
            ? 'confirmation unavailable — check transaction status before retrying'
            : 'not submitted — resolve the error and retry';
    } finally {
        // Release witness references; JavaScript cannot guarantee zeroization of strings.
        if (input) input.signer_key = '0';
        input = null;
        signingKey = null;
        signingInProgress = false;
        contractInput.disabled = false;
        if (contractInput.value !== contract) {
            document.getElementById('contractSignedDisplay').textContent = 'TEXT CHANGED';
            log('This result belongs to the submitted agreement below, not the edited text.');
        }
        document.getElementById('result').classList.add('show');
        document.getElementById('signBtn').disabled = Boolean(confirmedSignerReceipt &&
            confirmedSignerReceipt.contract === contractInput.value);
    }
}
