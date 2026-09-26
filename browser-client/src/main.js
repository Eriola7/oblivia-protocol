const { sha256 } = require('@noble/hashes/sha2.js');
const snarkjs = require('snarkjs');
const tf = require('@tensorflow/tfjs');
const faceLandmarksDetection = require('@tensorflow-models/face-landmarks-detection');
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

let biometricCaptured = false;
let biometricFeatures = null;
let detector = null;
let captureInProgress = false;
let signingInProgress = false;

window.addEventListener('DOMContentLoaded', () => {
    document.getElementById('contract').addEventListener('input', () => {
        if (signingInProgress) return;
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

function quantizeFeatures(features) {
    return features.map(f => Math.round(f * 255));
}

function applyErrorCorrection(quantized) {
    const bucketSize = 64;
    return quantized.map(v => Math.floor(v / bucketSize) * bucketSize);
}

function deriveKey(features) {
    const quantized = quantizeFeatures(features);
    const corrected = applyErrorCorrection(quantized);
    const bytes = new Uint8Array(corrected.map(v => v & 0xFF));
    const salt = new TextEncoder().encode('oblivia-v1');
    const combined = new Uint8Array(bytes.length + salt.length);
    combined.set(bytes);
    combined.set(salt, bytes.length);
    const hash = sha256(combined);
    return Array.from(hash).map(b => b.toString(16).padStart(2, '0')).join('');
}

function extractFaceFeatures(landmarks) {
    // Extract 20 stable geometric ratios from face landmarks
    const points = landmarks.keypoints;
    
    const dist = (a, b) => Math.sqrt(
        Math.pow(points[a].x - points[b].x, 2) + 
        Math.pow(points[a].y - points[b].y, 2)
    );
    
    const faceWidth = dist(234, 454);
    
    // Normalize all distances by face width for scale invariance
    const features = [
        dist(33, 263) / faceWidth,   // eye distance
        dist(1, 152) / faceWidth,    // nose to chin
        dist(61, 291) / faceWidth,   // mouth width
        dist(17, 0) / faceWidth,     // lip height
        dist(133, 362) / faceWidth,  // inner eye distance
        dist(70, 300) / faceWidth,   // brow width
        dist(159, 145) / faceWidth,  // left eye height
        dist(386, 374) / faceWidth,  // right eye height
        dist(94, 19) / faceWidth,    // nose width
        dist(2, 94) / faceWidth,     // nose length
        dist(78, 308) / faceWidth,   // outer mouth width
        dist(13, 14) / faceWidth,    // mouth opening
        dist(168, 6) / faceWidth,    // nose bridge
        dist(55, 285) / faceWidth,   // brow arch left
        dist(8, 168) / faceWidth,    // forehead height
        dist(454, 356) / faceWidth,  // jaw right
        dist(234, 127) / faceWidth,  // jaw left
        dist(152, 378) / faceWidth,  // chin shape
        dist(263, 362) / faceWidth,  // outer right eye
        dist(33, 133) / faceWidth,   // outer left eye
    ];
    
    return features;
}

async function loadDetector() {
    log('Loading face detection model...');
    const model = faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh;
    detector = await faceLandmarksDetection.createDetector(model, {
        runtime: 'tfjs',
        refineLandmarks: false,
        maxFaces: 1
    });
    log('Model loaded');
}

window.captureBiometric = async function() {
    if (captureInProgress || signingInProgress) return;
    captureInProgress = true;
    const box = document.getElementById('biometricBox');
    const status = document.getElementById('biometricStatus');
    const icon = document.getElementById('biometricIcon');
    document.getElementById('signBtn').disabled = true;
    biometricCaptured = false;
    if (biometricFeatures) biometricFeatures.fill(0);
    biometricFeatures = null;
    box.classList.remove('active');
    let stream;
    let video;
    
    try {
        if (!detector) await loadDetector();
        
        status.textContent = 'Accessing camera...';
        stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480, facingMode: 'user' } 
        });
        
        video = document.createElement('video');
        video.srcObject = stream;
        video.width = 640;
        video.height = 480;
        await video.play();
        
        status.textContent = 'Scanning face... hold still';
        icon.textContent = '◎';
        
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const faces = await detector.estimateFaces(video);
        stream.getTracks().forEach(t => t.stop());
        
        if (faces.length === 0) {
            status.textContent = 'No face detected. Try again.';
            return;
        }
        
        biometricFeatures = extractFaceFeatures(faces[0]);
        biometricCaptured = true;
        
        box.classList.add('active');
        status.textContent = 'Biometric captured. Key derived on-device.';
        icon.textContent = '◉';
        
        document.getElementById('signBtn').disabled = false;
        log('Face detected — 20 geometric ratios extracted', 'success');
        log('Signing key derived on-device — never transmitted', 'success');
        
    } catch(e) {
        log('Error: ' + e.message);
        status.textContent = 'Error. Try again.';
    } finally {
        if (stream) stream.getTracks().forEach(t => t.stop());
        if (video) video.srcObject = null;
        captureInProgress = false;
    }
}

window.signContract = async function() {
    if (signingInProgress || captureInProgress) return;
    const contractInput = document.getElementById('contract');
    const contract = contractInput.value;
    if (!contract) { log('Please enter contract text'); return; }
    if (!biometricCaptured) { log('Please capture biometric first'); return; }

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
        log('Deriving signing key from biometric...');
        signingKey = deriveKey(biometricFeatures);
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
            signer_key: BigInt('0x' + signingKey.slice(0, 32)).toString(),
            timestamp: Date.now().toString()
        };
        const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, RELAY_URL + '/proving-assets/oblivia_js/oblivia.wasm', RELAY_URL + '/proving-assets/oblivia_1.zkey');
        const payload = anchorProof(proof, publicSignals);
        log('Proof generated — awaiting on-chain verification', 'success');
        const proofPreview = payload.proofA.slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('') + '...';
        document.getElementById('proofDisplay').textContent = proofPreview;

        const keyCommitment = '0x' + Buffer.from(payload.keyCommitment).toString('hex');
        const signatureCommitment = '0x' + Buffer.from(payload.signatureCommitment).toString('hex');

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
        const txDisplay = document.getElementById('txDisplay');
        const link = document.createElement('a');
        link.href = 'https://explorer.solana.com/tx/' + data.transaction + '?cluster=devnet';
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = data.transaction.slice(0, 20) + '...';
        txDisplay.textContent = 'Verified on-chain: ';
        txDisplay.appendChild(link);
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
        document.getElementById('signBtn').disabled = false;
    }
}
