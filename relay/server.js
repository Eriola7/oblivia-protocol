require('dotenv').config({ path: require('path').join(__dirname, '../.env') }); require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const { Connection, Keypair, PublicKey } = require('@solana/web3.js');
const anchor = require('@coral-xyz/anchor');
const { validateMultisigConfig, assertMultisigConfig } = require('../sdk/lib/multisig_config');

const app = express();
const relayOrigins = (process.env.OBLIVIA_ALLOWED_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean);
app.use(cors({ origin: relayOrigins.length ? relayOrigins : false }));
app.use(express.json({ limit: '16kb' }));
app.use('/proving-assets', express.static(path.join(__dirname, '../zk_groth16')));

// A sponsored relay must never be an unauthenticated transaction oracle.
function requireRelayKey(req, res, next) {
    const configuredKey = process.env.OBLIVIA_RELAY_API_KEY;
    if (!configuredKey || req.get('authorization') !== `Bearer ${configuredKey}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

const relayWindows = new Map();
function limitSponsoredRequest(req, res, next) {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const state = relayWindows.get(key) || { start: now, count: 0 };
    if (now - state.start > 60 * 60 * 1000) { state.start = now; state.count = 0; }
    if (++state.count > 10) return res.status(429).json({ error: 'Sponsored signing limit reached; try again later.' });
    relayWindows.set(key, state);
    next();
}

function parseHex32(value, name) {
    if (typeof value !== 'string' || !/^(?:0x)?[0-9a-fA-F]{64}$/.test(value)) {
        throw new Error(`${name} must be exactly 32 bytes of hexadecimal`);
    }
    return Buffer.from(value.replace(/^0x/, ''), 'hex');
}

function parseBytes32(value, name) {
    if (!Array.isArray(value) || value.length !== 32 || value.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
        throw new Error(`${name} must be an array of exactly 32 bytes`);
    }
    return Buffer.from(value);
}

function parseByteArray(value, length, name) {
    if (!Array.isArray(value) || value.length !== length || value.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
        throw new Error(`${name} must be an array of exactly ${length} bytes`);
    }
    return value;
}

const PROGRAM_ID = new PublicKey('HaRpXyybfpYpwxkhfj8CjY8EjGqvRd96Zi33iSCTxvHG');
const REGISTRY_SEED = Buffer.from('oblivia_registry');
const CONTRACT_SEED = Buffer.from('oblivia_contract');
const SIGNATURE_SEED = Buffer.from('oblivia_signature');
const MULTISIG_SEED = Buffer.from('oblivia_multisig');
const MULTISIG_MEMBER_SEED = Buffer.from('oblivia_multisig_member');

// Testnet — sponsored by faucet-funded fee payer
const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

function getKeypair() {
    const secretHex = process.env.OBLIVIA_DEVNET_KEY;
    return Keypair.fromSecretKey(Buffer.from(secretHex, 'hex'));
}

function getProgram() {
    const keypair = getKeypair();
    const wallet = new anchor.Wallet(keypair);
    const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
    const idl = require('../sdk/lib/idl.json');
    return { program: new anchor.Program(idl, provider), keypair };
}

app.get('/', (req, res) => res.json({ status: 'Oblivia relay live' }));

// Lets the public client distinguish a healthy relay from a relay whose
// sponsor key was entered incorrectly, without exposing the key itself.
app.get('/health', (req, res) => {
    try {
        const secretHex = process.env.OBLIVIA_DEVNET_KEY;
        if (typeof secretHex !== 'string' || !/^[0-9a-fA-F]{128}$/.test(secretHex)) {
            return res.status(503).json({ status: 'signer misconfigured' });
        }
        Keypair.fromSecretKey(Buffer.from(secretHex, 'hex'));
        return res.json({ status: 'ready' });
    } catch (_) {
        return res.status(503).json({ status: 'signer misconfigured' });
    }
});

app.post('/sign', limitSponsoredRequest, async (req, res) => {
    try {
        const { contractHash, keyCommitment, signatureCommitment, proofA, proofB, proofC, publicInputs } = req.body;

        const contractHashBytes = parseBytes32(contractHash, 'contractHash');
        const keyCommitmentBytes = parseHex32(keyCommitment, 'keyCommitment');
        const sigCommitmentBytes = parseHex32(signatureCommitment, 'signatureCommitment');

        // Reject malformed proof fields before creating accounts or spending rent.
        const validatedProof = [
            parseByteArray(proofA, 64, 'proofA'),
            parseByteArray(proofB, 128, 'proofB'),
            parseByteArray(proofC, 64, 'proofC'),
            parseByteArray(publicInputs, 128, 'publicInputs'),
        ];

        const { program, keypair } = getProgram();

        const [registryPda] = PublicKey.findProgramAddressSync([REGISTRY_SEED], PROGRAM_ID);
        const [contractPda] = PublicKey.findProgramAddressSync([CONTRACT_SEED, contractHashBytes], PROGRAM_ID);
        const [signaturePda] = PublicKey.findProgramAddressSync(
            [SIGNATURE_SEED, contractPda.toBuffer(), keyCommitmentBytes, sigCommitmentBytes], PROGRAM_ID);
        const [signerRecordPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('oblivia_signer_record'), contractHashBytes, keyCommitmentBytes], PROGRAM_ID);

        // Register contract if it doesn't exist yet
        const contractInfo = await connection.getAccountInfo(contractPda);
        if (!contractInfo) {
            await program.methods
                .registerContract(Array.from(contractHashBytes))
                .accounts({
                    registry: registryPda,
                    contract: contractPda,
                    payer: keypair.publicKey,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .signers([keypair])
                .rpc();
        }

        // Verify and record the signature atomically. The program checks that the
        // proof's public contract limbs and commitments match these arguments.
        const tx = await program.methods
            .verifyGroth16V2(
                ...validatedProof,
                Array.from(keyCommitmentBytes), Array.from(sigCommitmentBytes),
            )
            .accounts({
                registry: registryPda,
                contract: contractPda,
                signature: signaturePda,
                signerRecord: signerRecordPda,
                payer: keypair.publicKey,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([keypair])
            .rpc();

        res.json({
            transaction: tx,
            explorer: 'https://explorer.solana.com/tx/' + tx + '?cluster=devnet'
        });
    } catch (e) {
        res.json({ error: e.message });
    }
});


// ---- MULTISIG ----

app.post('/multisig/create', limitSponsoredRequest, async (req, res) => {
    try {
        const { contractHash, threshold, maxSigners } = req.body;
        validateMultisigConfig(threshold, maxSigners);
        const contractHashBytes = parseBytes32(contractHash, 'contractHash');
        const { program, keypair } = getProgram();

        const [registryPda] = PublicKey.findProgramAddressSync([REGISTRY_SEED], PROGRAM_ID);
        const [contractPda] = PublicKey.findProgramAddressSync([CONTRACT_SEED, contractHashBytes], PROGRAM_ID);
        const [multisigPda] = PublicKey.findProgramAddressSync([MULTISIG_SEED, contractHashBytes], PROGRAM_ID);

        const contractInfo = await connection.getAccountInfo(contractPda);
        if (!contractInfo) {
            await program.methods.registerContract(Array.from(contractHashBytes))
                .accounts({ registry: registryPda, contract: contractPda, payer: keypair.publicKey, systemProgram: anchor.web3.SystemProgram.programId })
                .signers([keypair]).rpc();
        }

        const multisigInfo = await connection.getAccountInfo(multisigPda);
        if (multisigInfo) {
            const existing = await program.account.multiSigContract.fetch(multisigPda);
            assertMultisigConfig(existing, threshold, maxSigners);
            return res.json({ alreadyExists: true, multisig: multisigPda.toString() });
        }

        const tx = await program.methods.createMultisig(Array.from(contractHashBytes), threshold, maxSigners)
            .accounts({ contract: contractPda, multisig: multisigPda, payer: keypair.publicKey, systemProgram: anchor.web3.SystemProgram.programId })
            .signers([keypair]).rpc();

        res.json({ transaction: tx, multisig: multisigPda.toString(), explorer: 'https://explorer.solana.com/tx/' + tx + '?cluster=devnet' });
    } catch (e) { res.json({ error: e.message }); }
});

app.post('/multisig/sign', limitSponsoredRequest, async (req, res) => {
    try {
        const { contractHash, keyCommitment, signatureCommitment, proofA, proofB, proofC, publicInputs } = req.body;
        const contractHashBytes = parseBytes32(contractHash, 'contractHash');
        const keyCommitmentBytes = parseHex32(keyCommitment, 'keyCommitment');
        const sigCommitmentBytes = parseHex32(signatureCommitment, 'signatureCommitment');
        const { program, keypair } = getProgram();

        const [registryPda] = PublicKey.findProgramAddressSync([REGISTRY_SEED], PROGRAM_ID);
        const [contractPda] = PublicKey.findProgramAddressSync([CONTRACT_SEED, contractHashBytes], PROGRAM_ID);
        const [signaturePda] = PublicKey.findProgramAddressSync([SIGNATURE_SEED, contractPda.toBuffer(), keyCommitmentBytes, sigCommitmentBytes], PROGRAM_ID);
        const [multisigPda] = PublicKey.findProgramAddressSync([MULTISIG_SEED, contractHashBytes], PROGRAM_ID);
        const [memberPda] = PublicKey.findProgramAddressSync([MULTISIG_MEMBER_SEED, multisigPda.toBuffer(), keyCommitmentBytes], PROGRAM_ID);

        const verify = await program.methods.verifyGroth16V2(
            parseByteArray(proofA, 64, 'proofA'), parseByteArray(proofB, 128, 'proofB'), parseByteArray(proofC, 64, 'proofC'), parseByteArray(publicInputs, 128, 'publicInputs'),
            Array.from(keyCommitmentBytes), Array.from(sigCommitmentBytes)
        ).accounts({ registry: registryPda, contract: contractPda, signature: signaturePda, signerRecord: PublicKey.findProgramAddressSync([Buffer.from('oblivia_signer_record'), contractHashBytes, keyCommitmentBytes], PROGRAM_ID)[0], payer: keypair.publicKey, systemProgram: anchor.web3.SystemProgram.programId }).instruction();
        const record = await program.methods.recordVerifiedMultisig(Array.from(contractHashBytes), Array.from(keyCommitmentBytes))
            .accounts({ registry: registryPda, contract: contractPda, multisig: multisigPda, signerRecord: PublicKey.findProgramAddressSync([Buffer.from('oblivia_signer_record'), contractHashBytes, keyCommitmentBytes], PROGRAM_ID)[0], signature: signaturePda, multisigMember: memberPda, payer: keypair.publicKey, systemProgram: anchor.web3.SystemProgram.programId }).instruction();
        const tx = await program.provider.sendAndConfirm(new anchor.web3.Transaction().add(verify, record), [keypair]);

        const receipt = { transaction: tx, explorer: 'https://explorer.solana.com/tx/' + tx + '?cluster=devnet' };
        try {
            const ms = await program.account.multiSigContract.fetch(multisigPda);
            res.json({ ...receipt, collected: ms.signaturesCollected, threshold: ms.threshold, finalized: ms.finalized });
        } catch (_) {
            // The transaction is confirmed even if this optional state read fails.
            // Preserve its receipt so the client does not invite a duplicate retry.
            res.json({ ...receipt, statusUnavailable: true });
        }
    } catch (e) { res.json({ error: e.message }); }
});

app.get('/multisig/status/:hash', async (req, res) => {
    try {
        const contractHashBytes = Buffer.from(JSON.parse(req.params.hash)).slice(0, 32);
        const { program } = getProgram();
        const [multisigPda] = PublicKey.findProgramAddressSync([MULTISIG_SEED, contractHashBytes], PROGRAM_ID);
        const ms = await program.account.multiSigContract.fetch(multisigPda);
        res.json({ collected: ms.signaturesCollected, threshold: ms.threshold, maxSigners: ms.maxSigners, finalized: ms.finalized });
    } catch (e) { res.json({ error: e.message, exists: false }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Oblivia relay running on port ' + PORT));
