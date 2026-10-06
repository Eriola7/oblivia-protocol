require('dotenv').config({ path: require('path').join(__dirname, '../.env') }); require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const { Connection, Keypair, PublicKey } = require('@solana/web3.js');
const anchor = require('@coral-xyz/anchor');
const { validateMultisigConfig, assertMultisigConfig } = require('../sdk/lib/multisig_config');
const { createAccountReaders, initializeOrReadExisting } = require('../sdk/lib/account_state');
const { readContractAccount, readMultisigAccount } = createAccountReaders(anchor);

const app = express();
const relayOrigins = (process.env.OBLIVIA_ALLOWED_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean);
app.use(cors({ origin: relayOrigins.length ? relayOrigins : false }));
app.use(express.json({ limit: '16kb' }));
app.use('/proving-assets', express.static(path.join(__dirname, '../zk_groth16')));

class RelayError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

function sendRelayError(res, error) {
    const known = error instanceof RelayError;
    return res.status(known ? error.status : 500).json({
        error: known ? error.message : 'Relay request failed',
    });
}

function validateRequestBody(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new RelayError(400, 'Request body must be a JSON object');
    }
    return body;
}

// Classify failures where their meaning is known; do not guess from RPC error
// strings or turn an unavailable upstream into a claim that an account is absent.
function validateRequestConfig(threshold, maxSigners) {
    try { validateMultisigConfig(threshold, maxSigners); }
    catch (error) { throw new RelayError(400, error.message); }
}

function assertRequestedConfig(existing, threshold, maxSigners) {
    try { assertMultisigConfig(existing, threshold, maxSigners); }
    catch (error) { throw new RelayError(409, error.message); }
}

function decodeAccount(read) {
    try { return read(); }
    catch (error) { throw new RelayError(502, error.message); }
}

async function upstreamRequest(request) {
    try { return await request(); }
    catch (error) {
        if (error instanceof RelayError) throw error;
        throw new RelayError(502, error && error.message ? error.message : 'Solana request failed');
    }
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
        throw new RelayError(400, `${name} must be exactly 32 bytes of hexadecimal`);
    }
    return Buffer.from(value.replace(/^0x/, ''), 'hex');
}

function parseBytes32(value, name) {
    return Buffer.from(parseByteArray(value, 32, name));
}

function parseByteArray(value, length, name) {
    const invalid = () => new RelayError(400, `${name} must be an array of exactly ${length} bytes`);
    if (!Array.isArray(value) || value.length !== length) throw invalid();
    // Iteration also rejects sparse arrays; Array.prototype.some skips holes.
    for (const byte of value) {
        if (!Number.isInteger(byte) || byte < 0 || byte > 255) throw invalid();
    }
    return value;
}

function parseStatusHash(value) {
    let parsed;
    try { parsed = JSON.parse(value); }
    catch (_) { throw new RelayError(400, 'contractHash must be a JSON-encoded array of exactly 32 bytes'); }
    return parseBytes32(parsed, 'contractHash');
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
    if (typeof secretHex !== 'string' || !/^[0-9a-fA-F]{128}$/.test(secretHex)) {
        throw new Error('Relay signer is misconfigured');
    }
    return Keypair.fromSecretKey(Buffer.from(secretHex, 'hex'));
}

function getProgram() {
    try {
        const keypair = getKeypair();
        const wallet = new anchor.Wallet(keypair);
        const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
        const idl = require('../sdk/lib/idl.json');
        return { program: new anchor.Program(idl, provider), keypair };
    } catch (_) {
        throw new RelayError(503, 'Relay signer or program configuration is unavailable');
    }
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
        const { contractHash, keyCommitment, signatureCommitment, proofA, proofB, proofC, publicInputs } = validateRequestBody(req.body);

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

        // A funded system-owned PDA still needs registration.
        const contractInfo = await upstreamRequest(() => connection.getAccountInfo(contractPda));
        if (!decodeAccount(() => readContractAccount(contractInfo, contractHashBytes))) {
            await initializeOrReadExisting({
                initialize: () => upstreamRequest(() => program.methods
                    .registerContract(Array.from(contractHashBytes))
                    .accounts({
                        registry: registryPda,
                        contract: contractPda,
                        payer: keypair.publicKey,
                        systemProgram: anchor.web3.SystemProgram.programId,
                    })
                    .signers([keypair])
                    .rpc()),
                fetchAccount: () => upstreamRequest(() => connection.getAccountInfo(contractPda)),
                readAccount: info => decodeAccount(() => readContractAccount(info, contractHashBytes)),
            });
        }

        // Verify and record the signature atomically. The program checks that the
        // proof's public contract limbs and commitments match these arguments.
        const tx = await upstreamRequest(() => program.methods
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
            .rpc());

        res.json({
            transaction: tx,
            explorer: 'https://explorer.solana.com/tx/' + tx + '?cluster=devnet'
        });
    } catch (e) {
        sendRelayError(res, e);
    }
});


// ---- MULTISIG ----

app.post('/multisig/create', limitSponsoredRequest, async (req, res) => {
    try {
        const { contractHash, threshold, maxSigners } = validateRequestBody(req.body);
        validateRequestConfig(threshold, maxSigners);
        const contractHashBytes = parseBytes32(contractHash, 'contractHash');
        const { program, keypair } = getProgram();

        const [registryPda] = PublicKey.findProgramAddressSync([REGISTRY_SEED], PROGRAM_ID);
        const [contractPda] = PublicKey.findProgramAddressSync([CONTRACT_SEED, contractHashBytes], PROGRAM_ID);
        const [multisigPda] = PublicKey.findProgramAddressSync([MULTISIG_SEED, contractHashBytes], PROGRAM_ID);

        const contractInfo = await upstreamRequest(() => connection.getAccountInfo(contractPda));
        const contract = decodeAccount(() => readContractAccount(contractInfo, contractHashBytes));
        const multisigInfo = await upstreamRequest(() => connection.getAccountInfo(multisigPda));
        const existing = decodeAccount(() => readMultisigAccount(multisigInfo, contractPda));
        // Validate existing accounts and policy before spending registration rent.
        if (existing) assertRequestedConfig(existing, threshold, maxSigners);
        if (!contract) {
            await initializeOrReadExisting({
                initialize: () => upstreamRequest(() => program.methods.registerContract(Array.from(contractHashBytes))
                    .accounts({ registry: registryPda, contract: contractPda, payer: keypair.publicKey, systemProgram: anchor.web3.SystemProgram.programId })
                    .signers([keypair]).rpc()),
                fetchAccount: () => upstreamRequest(() => connection.getAccountInfo(contractPda)),
                readAccount: info => decodeAccount(() => readContractAccount(info, contractHashBytes)),
            });
        }

        if (existing) {
            return res.json({ alreadyExists: true, multisig: multisigPda.toString() });
        }

        const tx = await initializeOrReadExisting({
            initialize: () => upstreamRequest(() => program.methods.createMultisig(Array.from(contractHashBytes), threshold, maxSigners)
                .accounts({ contract: contractPda, multisig: multisigPda, payer: keypair.publicKey, systemProgram: anchor.web3.SystemProgram.programId })
                .signers([keypair]).rpc()),
            fetchAccount: () => upstreamRequest(() => connection.getAccountInfo(multisigPda)),
            readAccount: info => {
                const account = decodeAccount(() => readMultisigAccount(info, contractPda));
                if (account) assertRequestedConfig(account, threshold, maxSigners);
                return account;
            },
        });
        if (tx === null) return res.json({ alreadyExists: true, multisig: multisigPda.toString() });

        res.json({ transaction: tx, multisig: multisigPda.toString(), explorer: 'https://explorer.solana.com/tx/' + tx + '?cluster=devnet' });
    } catch (e) { sendRelayError(res, e); }
});

app.post('/multisig/sign', limitSponsoredRequest, async (req, res) => {
    try {
        const { contractHash, keyCommitment, signatureCommitment, proofA, proofB, proofC, publicInputs } = validateRequestBody(req.body);
        const contractHashBytes = parseBytes32(contractHash, 'contractHash');
        const keyCommitmentBytes = parseHex32(keyCommitment, 'keyCommitment');
        const sigCommitmentBytes = parseHex32(signatureCommitment, 'signatureCommitment');
        const validatedProof = [
            parseByteArray(proofA, 64, 'proofA'),
            parseByteArray(proofB, 128, 'proofB'),
            parseByteArray(proofC, 64, 'proofC'),
            parseByteArray(publicInputs, 128, 'publicInputs'),
        ];
        const { program, keypair } = getProgram();

        const [registryPda] = PublicKey.findProgramAddressSync([REGISTRY_SEED], PROGRAM_ID);
        const [contractPda] = PublicKey.findProgramAddressSync([CONTRACT_SEED, contractHashBytes], PROGRAM_ID);
        const [signaturePda] = PublicKey.findProgramAddressSync([SIGNATURE_SEED, contractPda.toBuffer(), keyCommitmentBytes, sigCommitmentBytes], PROGRAM_ID);
        const [multisigPda] = PublicKey.findProgramAddressSync([MULTISIG_SEED, contractHashBytes], PROGRAM_ID);
        const [memberPda] = PublicKey.findProgramAddressSync([MULTISIG_MEMBER_SEED, multisigPda.toBuffer(), keyCommitmentBytes], PROGRAM_ID);

        const verify = await program.methods.verifyGroth16V2(
            ...validatedProof,
            Array.from(keyCommitmentBytes), Array.from(sigCommitmentBytes)
        ).accounts({ registry: registryPda, contract: contractPda, signature: signaturePda, signerRecord: PublicKey.findProgramAddressSync([Buffer.from('oblivia_signer_record'), contractHashBytes, keyCommitmentBytes], PROGRAM_ID)[0], payer: keypair.publicKey, systemProgram: anchor.web3.SystemProgram.programId }).instruction();
        const record = await program.methods.recordVerifiedMultisig(Array.from(contractHashBytes), Array.from(keyCommitmentBytes))
            .accounts({ registry: registryPda, contract: contractPda, multisig: multisigPda, signerRecord: PublicKey.findProgramAddressSync([Buffer.from('oblivia_signer_record'), contractHashBytes, keyCommitmentBytes], PROGRAM_ID)[0], signature: signaturePda, multisigMember: memberPda, payer: keypair.publicKey, systemProgram: anchor.web3.SystemProgram.programId }).instruction();
        const tx = await upstreamRequest(() => program.provider.sendAndConfirm(new anchor.web3.Transaction().add(verify, record), [keypair]));

        const receipt = { transaction: tx, explorer: 'https://explorer.solana.com/tx/' + tx + '?cluster=devnet' };
        try {
            const ms = await program.account.multiSigContract.fetch(multisigPda);
            res.json({ ...receipt, collected: ms.signaturesCollected, threshold: ms.threshold, finalized: ms.finalized });
        } catch (_) {
            // The transaction is confirmed even if this optional state read fails.
            // Preserve its receipt so the client does not invite a duplicate retry.
            res.json({ ...receipt, statusUnavailable: true });
        }
    } catch (e) { sendRelayError(res, e); }
});

app.get('/multisig/status/:hash', async (req, res) => {
    try {
        const contractHashBytes = parseStatusHash(req.params.hash);
        const [contractPda] = PublicKey.findProgramAddressSync([CONTRACT_SEED, contractHashBytes], PROGRAM_ID);
        const [multisigPda] = PublicKey.findProgramAddressSync([MULTISIG_SEED, contractHashBytes], PROGRAM_ID);
        // A public read does not need the sponsor's private key. Decode the
        // exact account ourselves to distinguish absence from RPC/binding errors.
        const info = await upstreamRequest(() => connection.getAccountInfo(multisigPda));
        const ms = decodeAccount(() => readMultisigAccount(info, contractPda));
        if (!ms) return res.status(404).json({ error: 'Multisig agreement not found', exists: false });
        res.json({ collected: ms.signatures_collected, threshold: ms.threshold, maxSigners: ms.maxSigners, finalized: ms.finalized });
    } catch (e) { sendRelayError(res, e); }
});

// Express parser/URI failures occur before a route's try/catch. Keep their
// responses JSON too, so clients can display a failure instead of HTML.
app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.type === 'entity.parse.failed') return sendRelayError(res, new RelayError(400, 'Request body must contain valid JSON'));
    if (error.type === 'entity.too.large') return sendRelayError(res, new RelayError(413, 'Request body exceeds the 16kb limit'));
    if (error.type === 'charset.unsupported' || error.type === 'encoding.unsupported') {
        return sendRelayError(res, new RelayError(415, 'Request body uses an unsupported encoding'));
    }
    if (error instanceof URIError) return sendRelayError(res, new RelayError(400, 'Request URL is malformed'));
    // Decompression and interrupted/invalid-length bodies may carry a parser
    // status without a named type. Do not turn those client errors into 500s.
    if (error.status === 400) return sendRelayError(res, new RelayError(400, 'Request body is malformed'));
    return sendRelayError(res, error);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Oblivia relay running on port ' + PORT));
