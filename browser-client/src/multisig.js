const { sha256 } = require('@noble/hashes/sha2.js');
const snarkjs = require('snarkjs');
const { validateMultisigConfig } = require('../../sdk/lib/multisig_config');
const { deriveSignerKey } = require('../../sdk/lib/signer_key');
const { createSignerPasskey, getPasskeySecret } = require('../../sdk/lib/passkey');
const { checkPasskeyDomain } = require('../../sdk/lib/passkey_domain');
const passkeyConfig = require('./passkey_config');

const RELAY_URL = 'https://oblivia-relay.onrender.com';
const FIELD_MODULUS = BigInt('21888242871839275222246405745257275088696311157297823662689037894645226208583');

function fieldBytes(value) { let n = BigInt(value); const out = new Uint8Array(32); for (let i = 31; i >= 0; i--) { out[i] = Number(n & 255n); n >>= 8n; } return out; }
function grothPayload(proof, signals) {
  return { proofA: Array.from([...fieldBytes(proof.pi_a[0]), ...fieldBytes(FIELD_MODULUS - BigInt(proof.pi_a[1]))]), proofB: Array.from([...fieldBytes(proof.pi_b[0][1]), ...fieldBytes(proof.pi_b[0][0]), ...fieldBytes(proof.pi_b[1][1]), ...fieldBytes(proof.pi_b[1][0])]), proofC: Array.from([...fieldBytes(proof.pi_c[0]), ...fieldBytes(proof.pi_c[1])]), publicInputs: signals.flatMap(signal => Array.from(fieldBytes(signal))), keyCommitment: Array.from(fieldBytes(signals[0])), signatureCommitment: Array.from(fieldBytes(signals[1])) };
}

// Face ID / Touch ID only unlocks a standard passkey; its PRF output is the signer secret.
let signerUnlocked = false;
let signerSecret = null;
let currentContract = null;
let currentHash = null;
let creatingInProgress = false;
let signingInProgress = false;
let statusRevision = 0;
// Finalization is terminal for this agreement, even if another pending operation fails.
let finalizedStatus = null;

async function relayResponse(response) {
  const data = await response.json();
  if (!response.ok || !data || typeof data !== 'object' || Array.isArray(data) || data.error) {
    throw new Error(data && data.error ? data.error : 'Relay returned an unsuccessful response');
  }
  return data;
}

function validateTransaction(transaction) {
  if (typeof transaction !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(transaction)) {
    throw new Error('Relay did not return a valid transaction signature');
  }
}

function validateStatus(status, minimumCollected = 0) {
  if (!Number.isInteger(status.threshold) || status.threshold < 1 || status.threshold > 255 ||
      !Number.isInteger(status.collected) || status.collected < minimumCollected || status.collected > status.threshold ||
      typeof status.finalized !== 'boolean' || status.finalized !== (status.collected >= status.threshold)) {
    throw new Error('Relay returned invalid agreement status');
  }
}

function renderStatus(status) {
  if (status.finalized && !finalizedStatus) {
    finalizedStatus = { collected: status.collected, threshold: status.threshold, finalized: true };
  }
  status = finalizedStatus || status;
  document.getElementById('progress').textContent =
    status.collected + ' of ' + status.threshold + ' signed' + (status.finalized ? ' — FINALIZED ✓' : '');
  if (status.finalized) {
    document.getElementById('scanBtn').disabled = true;
    document.getElementById('scanBtn').textContent = 'Agreement Finalized';
    const createBtn = document.getElementById('createPasskeyBtn');
    if (createBtn) createBtn.disabled = true;
  }
}

function showTransaction(transaction) {
  const txEl = document.getElementById('txLink');
  const link = document.createElement('a');
  link.href = 'https://explorer.solana.com/tx/' + transaction + '?cluster=devnet';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = transaction.slice(0, 20) + '...';
  txEl.textContent = 'On-chain transaction: ';
  txEl.appendChild(link);
  txEl.style.display = 'block';
}

function log(msg, type = 'step') {
  const el = document.getElementById('log');
  if (!el) return;
  const line = document.createElement('div');
  line.className = type;
  line.textContent = '> ' + msg;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function clearSigner() {
  if (signerSecret) signerSecret.fill(0);
  signerSecret = null;
  signerUnlocked = false;
}

function hashContract(text) {
  return Array.from(sha256(new TextEncoder().encode(text))).slice(0, 32);
}

window.addEventListener('DOMContentLoaded', () => {
  for (const id of ['contractInput', 'threshold', 'maxSigners']) {
    document.getElementById(id).addEventListener('input', () => {
      if (!creatingInProgress) document.getElementById('shareBox').style.display = 'none';
    });
  }
  const params = new URLSearchParams(window.location.search);
  const c = params.get('c');
  if (c) {
    // URLSearchParams has already decoded the value; preserve literal % text.
    currentContract = c;
    currentHash = hashContract(currentContract);
    showSignMode();
  } else {
    showCreateMode();
  }
});

function showCreateMode() {
  document.getElementById('createMode').style.display = 'block';
  document.getElementById('signMode').style.display = 'none';
}

async function showSignMode() {
  document.getElementById('createMode').style.display = 'none';
  document.getElementById('signMode').style.display = 'block';
  document.getElementById('contractDisplay').textContent = currentContract;
  await refreshStatus();
}

async function refreshStatus() {
  const revision = ++statusRevision;
  try {
    const res = await fetch(RELAY_URL + '/multisig/status/' + encodeURIComponent(JSON.stringify(currentHash)));
    const s = await relayResponse(res);
    if (revision !== statusRevision) return;
    if (s.exists === false) throw new Error('Multisig not found');
    validateStatus(s);
    renderStatus(s);
  } catch (e) {
    if (revision !== statusRevision) return;
    if (finalizedStatus) renderStatus(finalizedStatus);
    else document.getElementById('progress').textContent = 'Agreement status unavailable';
    log('Status error: ' + e.message);
  }
}

window.createMultisig = async function () {
  if (creatingInProgress) return;
  const contract = document.getElementById('contractInput').value;
  const threshold = Number(document.getElementById('threshold').value);
  const maxSigners = Number(document.getElementById('maxSigners').value);
  if (!contract) { log('Enter contract text'); return; }
  try { validateMultisigConfig(threshold, maxSigners); }
  catch (e) { log(e.message); return; }

  creatingInProgress = true;
  document.getElementById('createBtn').disabled = true;
  for (const id of ['contractInput', 'threshold', 'maxSigners']) document.getElementById(id).disabled = true;
  document.getElementById('shareBox').style.display = 'none';
  log('Creating multisig on Solana... (sponsored)');
  const hash = hashContract(contract);
  try {
    const res = await fetch(RELAY_URL + '/multisig/create', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contractHash: hash, threshold, maxSigners })
    });
    const data = await relayResponse(res);
    if (typeof data.multisig !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(data.multisig)) {
      throw new Error('Relay did not return a valid agreement address');
    }
    if (data.alreadyExists !== true) validateTransaction(data.transaction);
    log(data.alreadyExists === true ? 'Matching multisig already exists on-chain' : 'Multisig created on-chain', 'success');
    const link = window.location.origin + window.location.pathname + '?c=' + encodeURIComponent(contract);
    document.getElementById('shareLink').value = link;
    document.getElementById('shareBox').style.display = 'block';
  } catch (e) { log('Creation unconfirmed: ' + e.message); }
  finally {
    creatingInProgress = false;
    document.getElementById('createBtn').disabled = false;
    for (const id of ['contractInput', 'threshold', 'maxSigners']) document.getElementById(id).disabled = false;
  }
};

window.copyLink = function () {
  const el = document.getElementById('shareLink');
  el.select();
  document.execCommand('copy');
  log('Link copied \u2014 send it to your co-signers', 'success');
};

async function unlockSigner(create) {
  const scanBtn = document.getElementById('scanBtn');
  if (scanBtn.disabled || finalizedStatus) return;
  scanBtn.disabled = true;
  const status = document.getElementById('bioStatus');
  try {
    // Refuse before touching WebAuthn if this host is not the permanent passkey domain.
    const domain = checkPasskeyDomain(passkeyConfig, window.location.hostname);
    if (domain.temporary) log('Test build: passkeys created here are temporary and tied to this address');
    const rp = domain.rpId ? { rpId: domain.rpId } : {};
    if (create) {
      status.textContent = 'Creating passkey...';
      await createSignerPasskey({ ...rp, rpName: 'Oblivia', userName: 'Oblivia co-signer' });
      log('Passkey created \u2014 backed up by your platform keychain', 'success');
      if (finalizedStatus) return;
    }
    status.textContent = 'Confirm with Face ID, Touch ID or device PIN...';
    signerSecret = await getPasskeySecret(rp);
    if (finalizedStatus) return;
    signerUnlocked = true;
    status.textContent = 'Passkey unlocked \u2014 signing...';
    log('Passkey unlocked on-device \u2014 signer secret never transmitted', 'success');
    await doSign();
  } catch (e) {
    log('Error: ' + e.message);
    if (!finalizedStatus) {
      status.textContent = 'Passkey unavailable. Try again.';
      scanBtn.disabled = false;
    }
  } finally {
    clearSigner();
    if (finalizedStatus) {
      status.textContent = 'Agreement finalized.';
      renderStatus(finalizedStatus);
    }
  }
}

window.unlockAndSign = function () { return unlockSigner(false); };
window.createPasskeyAndSign = function () { return unlockSigner(true); };

async function doSign() {
  if (signingInProgress || finalizedStatus) return;
  if (!signerUnlocked) { log('Unlock your passkey first'); return; }
  const scanBtn = document.getElementById('scanBtn');
  if (scanBtn) scanBtn.disabled = true;
  signingInProgress = true;
  let signingKey;
  let input;
  let transaction;
  let submitting = false;
  try {
    log('Deriving key...');
    signingKey = deriveSignerKey(signerSecret);
    log('Generating ZK proof... (takes a moment)');
    const hex = currentHash.map(b => b.toString(16).padStart(2, '0')).join('');
    input = { contract_hash_lo: BigInt('0x' + hex.slice(0, 32)).toString(), contract_hash_hi: BigInt('0x' + hex.slice(32)).toString(), signer_key: signingKey, timestamp: Date.now().toString() };
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, RELAY_URL + '/proving-assets/oblivia_js/oblivia.wasm', RELAY_URL + '/proving-assets/oblivia_1.zkey');
    if (finalizedStatus) {
      log('Agreement already finalized — no signature submitted.');
      return;
    }
    const payload = grothPayload(proof, publicSignals);
    log('Proof generated — awaiting on-chain verification');
    const keyCommitment = '0x' + Buffer.from(payload.keyCommitment).toString('hex');
    const signatureCommitment = '0x' + Buffer.from(payload.signatureCommitment).toString('hex');
    submitting = true;
    log('Submitting to Solana... (sponsored)');
    const res = await fetch(RELAY_URL + '/multisig/sign', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contractHash: currentHash, keyCommitment, signatureCommitment, proofA: payload.proofA, proofB: payload.proofB, proofC: payload.proofC, publicInputs: payload.publicInputs })
    });
    const data = await relayResponse(res);
    validateTransaction(data.transaction);
    transaction = data.transaction;
    // A confirmed submission is newer than any already in-flight status GET,
    // including a GET whose body parsing or failure arrives after this point.
    statusRevision++;
    showTransaction(transaction);
    if (data.statusUnavailable === true) {
      if (finalizedStatus) {
        log('Signature confirmed on-chain; agreement finalized.', 'success');
      } else {
        log('Signature confirmed on-chain; agreement status is temporarily unavailable.', 'success');
        document.getElementById('progress').textContent = 'Signature confirmed — threshold status unavailable';
        if (scanBtn) scanBtn.textContent = 'Signed ✓ — check transaction for status';
      }
      return;
    }
    validateStatus(data, 1);
    renderStatus(data);
    log('Signed on-chain — identity concealed', 'success');
    if (data.finalized) {
      log('Threshold reached. Agreement finalized anonymously.', 'success');
    } else if (!finalizedStatus) {
      if (scanBtn) scanBtn.textContent = 'Signed ✓ — you have co-signed';
    }
  } catch (e) {
    log('Failed: ' + e.message);
    if (finalizedStatus) {
      renderStatus(finalizedStatus);
    } else if (transaction) {
      document.getElementById('progress').textContent = 'Transaction receipt received — agreement status unavailable';
      if (scanBtn) scanBtn.textContent = 'Check transaction before signing again';
    } else if (submitting) {
      document.getElementById('progress').textContent = 'Submission unconfirmed — check agreement status before retrying';
    }
  } finally {
    if (input) input.signer_key = '0';
    input = null;
    signingKey = null;
    signingInProgress = false;
    // A known confirmed submission must not invite an automatic duplicate retry.
    if (finalizedStatus) renderStatus(finalizedStatus);
    else if (scanBtn) scanBtn.disabled = Boolean(transaction);
  }
}
