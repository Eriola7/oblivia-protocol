// A 2-of-3 anonymous agreement on Devnet. The settings identify the agreement.
const oblivia = require('@oblivia/sdk');

async function main(secrets) {
    const agreement = 'Release milestone 2 funds to the build team.';
    await oblivia.createMultiSigContract(agreement, 2, 3);

    const first = await oblivia.signMultiSig(secrets[0], agreement, 2, 3);
    const second = await oblivia.signMultiSig(secrets[1], agreement, 2, 3); // finalizes at 2 of 3
    console.log(first.transaction, second.transaction);
}

module.exports = main;
