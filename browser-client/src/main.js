const { sha256 } = require('@noble/hashes/sha2.js');
const { Barretenberg, UltraHonkBackend } = require('@aztec/bb.js');
const { Noir } = require('@noir-lang/noir_js');
const circuit = require('../../zk_intent_circuit/target/zk_intent_circuit.json');
const tf = require('@tensorflow/tfjs');
const faceLandmarksDetection = require('@tensorflow-models/face-landmarks-detection');
const RELAY_URL = 'https://oblivia-relay.onrender.com';

let biometricCaptured = false;
let biometricFeatures = null;
let detector = null;

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
    const box = document.getElementById('biometricBox');
    const status = document.getElementById('biometricStatus');
    const icon = document.getElementById('biometricIcon');
    
    try {
        if (!detector) await loadDetector();
        
        status.textContent = 'Accessing camera...';
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: 640, height: 480, facingMode: 'user' } 
        });
        
        const video = document.createElement('video');
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
    }
}

window.signContract = async function() {
    const contract = document.getElementById('contract').value;
    if (!contract) { log('Please enter contract text'); return; }
    if (!biometricCaptured) { log('Please capture biometric first'); return; }
    
    document.getElementById('signBtn').disabled = true;
    document.getElementById('log').innerHTML = '';
    
    log('Deriving signing key from biometric...');
    const signingKey = deriveKey(biometricFeatures);
    log('Signing key derived — stored nowhere');
    
    log('Hashing contract...');
    const contractBytes = new TextEncoder().encode(contract);
    const contractHash = Array.from(sha256(contractBytes)).slice(0, 32);
    log('Contract hash computed');
    
    log('Generating ZK proof... (this takes a moment)');
    const api = await Barretenberg.new({ threads: 1 });
    const backend = new UltraHonkBackend(circuit.bytecode, api);
    const noir = new Noir(circuit);
    const input = {
        contract_hash: contractHash,
        signer_key: BigInt('0x' + signingKey.slice(0, 62)).toString(),
        timestamp: Date.now().toString()
    };
    const { witness } = await noir.execute(input);
    const proof = await backend.generateProof(witness);
    const zkVerified = await backend.verifyProof(proof);
    await api.destroy();
    if (!zkVerified) { log('Proof verification failed'); return; }
    log('Proof generated successfully', 'success');
    log('Verifying proof...');
    log('Proof verified', 'success');
    const proofPreview = Buffer.from(proof.proof).toString('hex').slice(0, 16) + '...';
    document.getElementById('proofDisplay').textContent = proofPreview;

    const keyCommitment = '0x' + BigInt(proof.publicInputs[0]).toString(16).padStart(64, '0');
    const signatureCommitment = '0x' + BigInt(proof.publicInputs[1]).toString(16).padStart(64, '0');

    log('Submitting to Solana... (sponsored — free to you)');
    try {
        const response = await fetch(RELAY_URL + '/sign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contractHash: Array.from(contractHash),
                keyCommitment,
                signatureCommitment
            })
        });
        const data = await response.json();
        if (data.error) {
            log('Submission failed: ' + data.error);
        } else {
            log('Signed on-chain — identity concealed', 'success');
            document.getElementById('txDisplay').innerHTML =
                'Verified on-chain: <a href="' + data.explorer + '" target="_blank">' +
                data.transaction.slice(0, 20) + '...</a>';
        }
    } catch (e) {
        log('Relay error: ' + e.message);
    }

    document.getElementById('result').classList.add('show');
    document.getElementById('signBtn').disabled = false;
    log('Done. Identity: concealed. Proof: on-chain.', 'success');
}
