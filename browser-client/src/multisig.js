const { sha256 } = require('@noble/hashes/sha2.js');
const snarkjs = require('snarkjs');
const tf = require('@tensorflow/tfjs');
const faceLandmarksDetection = require('@tensorflow-models/face-landmarks-detection');

const RELAY_URL = 'https://oblivia-relay.onrender.com';
const FIELD_MODULUS = BigInt('21888242871839275222246405745257275088696311157297823662689037894645226208583');

function fieldBytes(value) { let n = BigInt(value); const out = new Uint8Array(32); for (let i = 31; i >= 0; i--) { out[i] = Number(n & 255n); n >>= 8n; } return out; }
function grothPayload(proof, signals) {
  return { proofA: Array.from([...fieldBytes(proof.pi_a[0]), ...fieldBytes(FIELD_MODULUS - BigInt(proof.pi_a[1]))]), proofB: Array.from([...fieldBytes(proof.pi_b[0][1]), ...fieldBytes(proof.pi_b[0][0]), ...fieldBytes(proof.pi_b[1][1]), ...fieldBytes(proof.pi_b[1][0])]), proofC: Array.from([...fieldBytes(proof.pi_c[0]), ...fieldBytes(proof.pi_c[1])]), publicInputs: Array.from(signals.flatMap(fieldBytes)), keyCommitment: Array.from(fieldBytes(signals[0])), signatureCommitment: Array.from(fieldBytes(signals[1])) };
}

let biometricCaptured = false;
let biometricFeatures = null;
let detector = null;
let currentContract = null;
let currentHash = null;

function log(msg, type = 'step') {
  const el = document.getElementById('log');
  if (!el) return;
  const line = document.createElement('div');
  line.className = type;
  line.textContent = '> ' + msg;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function quantizeFeatures(f) { return f.map(x => Math.round(x * 255)); }
function applyErrorCorrection(q) { const b = 64; return q.map(v => Math.floor(v / b) * b); }
function deriveKey(features) {
  const c = applyErrorCorrection(quantizeFeatures(features));
  const bytes = new Uint8Array(c.map(v => v & 0xFF));
  const salt = new TextEncoder().encode('oblivia-v1');
  const combined = new Uint8Array(bytes.length + salt.length);
  combined.set(bytes); combined.set(salt, bytes.length);
  const hash = sha256(combined);
  return Array.from(hash).map(b => b.toString(16).padStart(2, '0')).join('');
}
function extractFaceFeatures(landmarks) {
  const p = landmarks.keypoints;
  const d = (a, b) => Math.sqrt(Math.pow(p[a].x - p[b].x, 2) + Math.pow(p[a].y - p[b].y, 2));
  const fw = d(234, 454);
  return [d(33, 263) / fw, d(1, 152) / fw, d(61, 291) / fw, d(17, 0) / fw, d(133, 362) / fw, d(70, 300) / fw, d(159, 145) / fw, d(386, 374) / fw, d(94, 19) / fw, d(2, 94) / fw, d(78, 308) / fw, d(13, 14) / fw, d(168, 6) / fw, d(55, 285) / fw, d(8, 168) / fw, d(454, 356) / fw, d(234, 127) / fw, d(152, 378) / fw, d(263, 362) / fw, d(33, 133) / fw];
}
async function loadDetector() {
  log('Loading face model...');
  const model = faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh;
  detector = await faceLandmarksDetection.createDetector(model, { runtime: 'tfjs', refineLandmarks: false, maxFaces: 1 });
  log('Model loaded');
}

function hashContract(text) {
  return Array.from(sha256(new TextEncoder().encode(text))).slice(0, 32);
}

window.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const c = params.get('c');
  if (c) {
    currentContract = decodeURIComponent(c);
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
  try {
    const res = await fetch(RELAY_URL + '/multisig/status/' + encodeURIComponent(JSON.stringify(currentHash)));
    const s = await res.json();
    if (s.error || s.exists === false) {
      document.getElementById('progress').textContent = 'Multisig not found';
      return;
    }
    document.getElementById('progress').textContent =
      s.collected + ' of ' + s.threshold + ' signed' + (s.finalized ? ' \u2014 FINALIZED \u2713' : '');
    if (s.finalized) {
      document.getElementById('scanBtn').disabled = true;
      document.getElementById('scanBtn').textContent = 'Agreement Finalized';
    }
  } catch (e) { log('Status error: ' + e.message); }
}

window.createMultisig = async function () {
  const contract = document.getElementById('contractInput').value;
  const threshold = parseInt(document.getElementById('threshold').value);
  const maxSigners = parseInt(document.getElementById('maxSigners').value);
  if (!contract) { log('Enter contract text'); return; }
  if (threshold > maxSigners) { log('Threshold cannot exceed max signers'); return; }

  document.getElementById('createBtn').disabled = true;
  log('Creating multisig on Solana... (sponsored)');
  const hash = hashContract(contract);
  try {
    const res = await fetch(RELAY_URL + '/multisig/create', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contractHash: hash, threshold, maxSigners })
    });
    const data = await res.json();
    if (data.error) { log('Failed: ' + data.error); document.getElementById('createBtn').disabled = false; return; }
    log('Multisig created on-chain', 'success');
    const link = window.location.origin + window.location.pathname + '?c=' + encodeURIComponent(contract);
    document.getElementById('shareLink').value = link;
    document.getElementById('shareBox').style.display = 'block';
  } catch (e) { log('Error: ' + e.message); document.getElementById('createBtn').disabled = false; }
};

window.copyLink = function () {
  const el = document.getElementById('shareLink');
  el.select();
  document.execCommand('copy');
  log('Link copied \u2014 send it to your co-signers', 'success');
};

window.captureBiometric = async function () {
  const status = document.getElementById('bioStatus');
  try {
    if (!detector) await loadDetector();
    status.textContent = 'Accessing camera...';
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' } });
    const video = document.createElement('video');
    video.srcObject = stream; video.width = 640; video.height = 480;
    await video.play();
    status.textContent = 'Scanning... hold still';
    await new Promise(r => setTimeout(r, 3000));
    const faces = await detector.estimateFaces(video);
    stream.getTracks().forEach(t => t.stop());
    if (faces.length === 0) { status.textContent = 'No face detected. Try again.'; return; }
    biometricFeatures = extractFaceFeatures(faces[0]);
    biometricCaptured = true;
    status.textContent = 'Face captured \u2014 signing...';
    log('Face detected, key derived on-device', 'success');
    await doSign();
  } catch (e) { log('Error: ' + e.message); status.textContent = 'Error. Try again.'; }
};

async function doSign() {
  if (!biometricCaptured) { log('Capture your face first'); return; }
  const scanBtn = document.getElementById('scanBtn');
  if (scanBtn) scanBtn.disabled = true;
  log('Deriving key...');
  const signingKey = deriveKey(biometricFeatures);
  log('Generating ZK proof... (takes a moment)');
  const hex = currentHash.map(b => b.toString(16).padStart(2, '0')).join('');
  const input = { contract_hash_lo: BigInt('0x' + hex.slice(0, 32)).toString(), contract_hash_hi: BigInt('0x' + hex.slice(32)).toString(), signer_key: BigInt('0x' + signingKey.slice(0, 32)).toString(), timestamp: Date.now().toString() };
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, RELAY_URL + '/proving-assets/oblivia_js/oblivia.wasm', RELAY_URL + '/proving-assets/oblivia_1.zkey');
  const payload = grothPayload(proof, publicSignals);
  log('Proof generated', 'success');
  const keyCommitment = '0x' + Buffer.from(payload.keyCommitment).toString('hex');
  const signatureCommitment = '0x' + Buffer.from(payload.signatureCommitment).toString('hex');
  log('Submitting to Solana... (sponsored)');
  try {
    const res = await fetch(RELAY_URL + '/multisig/sign', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contractHash: currentHash, keyCommitment, signatureCommitment, proofA: payload.proofA, proofB: payload.proofB, proofC: payload.proofC, publicInputs: payload.publicInputs })
    });
    const data = await res.json();
    if (data.error) { log('Failed: ' + data.error); document.getElementById('scanBtn').disabled = false; return; }
    log('Signed on-chain \u2014 identity concealed', 'success');
    if (data.explorer) {
      const txEl = document.getElementById('txLink');
      txEl.innerHTML = 'On-chain: <a href="' + data.explorer + '" target="_blank" style="color:#00ff88">' + data.transaction.slice(0,20) + '...</a>';
      txEl.style.display = 'block';
    }
    document.getElementById('progress').textContent = data.collected + ' of ' + data.threshold + ' signed' + (data.finalized ? ' \u2014 FINALIZED \u2713' : '');
    const scanBtn = document.getElementById('scanBtn');
    if (data.finalized) {
      log('Threshold reached. Agreement finalized anonymously.', 'success');
      if (scanBtn) { scanBtn.disabled = true; scanBtn.textContent = 'Agreement Finalized'; }
    } else {
      if (scanBtn) { scanBtn.textContent = 'Signed \u2713 \u2014 you have co-signed'; }
    }
  } catch (e) { log('Error: ' + e.message); const b = document.getElementById('scanBtn'); if (b) b.disabled = false; }
}
