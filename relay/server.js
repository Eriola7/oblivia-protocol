require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const { Connection, Keypair, PublicKey } = require('@solana/web3.js');
const anchor = require('@coral-xyz/anchor');

const app = express();
app.use(cors());
app.use(express.json());

const PROGRAM_ID = new PublicKey('HaRpXyybfpYpwxkhfj8CjY8EjGqvRd96Zi33iSCTxvHG');
const REGISTRY_SEED = Buffer.from('oblivia_registry');
const CONTRACT_SEED = Buffer.from('oblivia_contract');
const SIGNATURE_SEED = Buffer.from('oblivia_signature');

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

app.post('/sign', async (req, res) => {
    try {
        const { contractHash, keyCommitment, signatureCommitment } = req.body;

        const contractHashBytes = Buffer.from(contractHash).slice(0, 32);
        const keyCommitmentBytes = Buffer.from(keyCommitment.replace('0x', '').padEnd(64, '0'), 'hex').slice(0, 32);
        const sigCommitmentBytes = Buffer.from(signatureCommitment.replace('0x', '').padEnd(64, '0'), 'hex').slice(0, 32);

        const { program, keypair } = getProgram();

        const [registryPda] = PublicKey.findProgramAddressSync([REGISTRY_SEED], PROGRAM_ID);
        const [contractPda] = PublicKey.findProgramAddressSync([CONTRACT_SEED, contractHashBytes], PROGRAM_ID);
        const [signaturePda] = PublicKey.findProgramAddressSync(
            [SIGNATURE_SEED, keyCommitmentBytes, sigCommitmentBytes], PROGRAM_ID);
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

        // Submit the signature
        const tx = await program.methods
            .submitSignature(Array.from(keyCommitmentBytes), Array.from(sigCommitmentBytes))
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Oblivia relay running on port ' + PORT));
