require('dotenv').config();
const {
    Connection,
    Keypair,
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction,
    PublicKey,
    SystemProgram
} = require('@solana/web3.js');

const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

/**
 * Stores a proof hash on Solana devnet using the Memo program
 * This anchors the ZK proof to an immutable on-chain record
 */
async function storeProofOnChain(proofHex) {
    console.log('\n=== Solana Devnet Integration ===\n');
    
    // Load keypair from environment variable or generate ephemeral keypair
    // For production: set OBLIVIA_DEVNET_KEY environment variable
    const secretHex = process.env.OBLIVIA_DEVNET_KEY || null;
    const signer = secretHex 
        ? Keypair.fromSecretKey(Buffer.from(secretHex, 'hex'))
        : Keypair.generate();
    
    console.log('Using funded devnet wallet...');
    
    // Create memo instruction with proof hash
    const proofMemo = JSON.stringify({
        protocol: 'oblivia-v1',
        proof_hash: require('crypto').createHash('sha256').update(Buffer.from(proofHex, 'hex')).digest('hex'),
        timestamp: Date.now()
    });
    
    const memoInstruction = new TransactionInstruction({
        keys: [],
        programId: MEMO_PROGRAM_ID,
        data: Buffer.from(proofMemo, 'utf8')
    });
    
    const transaction = new Transaction().add(memoInstruction);
    
    console.log('Submitting proof hash to Solana devnet...');
    const signature = await sendAndConfirmTransaction(
        connection,
        transaction,
        [signer]
    );
    
    const explorerUrl = `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
    
    console.log('\n=== Proof Anchored On-Chain ===');
    console.log('Transaction:', signature);
    console.log('Explorer:   ', explorerUrl);
    console.log('Network:     Solana Devnet');
    console.log('Program:     Memo Program');
    
    return { signature, explorerUrl };
}

module.exports = { storeProofOnChain };
