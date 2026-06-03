const { execSync } = require('child_process');
const vk = require('./verification_key.json');

function toBigEndian32(numStr) {
    let n = BigInt(numStr);
    let bytes = [];
    for (let i = 0; i < 32; i++) {
        bytes.unshift(Number(n & 0xFFn));
        n >>= 8n;
    }
    return '[' + bytes.map(b => '0x' + b.toString(16).padStart(2,'0')).join(', ') + ']';
}

function g1Point(p) {
    return `(${toBigEndian32(p[0])}, ${toBigEndian32(p[1])})`;
}

function g2Point(p) {
    return `((${toBigEndian32(p[0][0])}, ${toBigEndian32(p[0][1])}), (${toBigEndian32(p[1][0])}, ${toBigEndian32(p[1][1])}))`;
}

console.log('// VK_ALPHA_1');
console.log(`const VK_ALPHA_X: [u8; 32] = ${toBigEndian32(vk.vk_alpha_1[0])};`);
console.log(`const VK_ALPHA_Y: [u8; 32] = ${toBigEndian32(vk.vk_alpha_1[1])};`);
console.log('');
console.log('// VK_BETA_2');
console.log(`const VK_BETA_X0: [u8; 32] = ${toBigEndian32(vk.vk_beta_2[0][0])};`);
console.log(`const VK_BETA_X1: [u8; 32] = ${toBigEndian32(vk.vk_beta_2[0][1])};`);
console.log(`const VK_BETA_Y0: [u8; 32] = ${toBigEndian32(vk.vk_beta_2[1][0])};`);
console.log(`const VK_BETA_Y1: [u8; 32] = ${toBigEndian32(vk.vk_beta_2[1][1])};`);
console.log('');
console.log('// VK_GAMMA_2');
console.log(`const VK_GAMMA_X0: [u8; 32] = ${toBigEndian32(vk.vk_gamma_2[0][0])};`);
console.log(`const VK_GAMMA_X1: [u8; 32] = ${toBigEndian32(vk.vk_gamma_2[0][1])};`);
console.log(`const VK_GAMMA_Y0: [u8; 32] = ${toBigEndian32(vk.vk_gamma_2[1][0])};`);
console.log(`const VK_GAMMA_Y1: [u8; 32] = ${toBigEndian32(vk.vk_gamma_2[1][1])};`);
console.log('');
console.log('// VK_DELTA_2');
console.log(`const VK_DELTA_X0: [u8; 32] = ${toBigEndian32(vk.vk_delta_2[0][0])};`);
console.log(`const VK_DELTA_X1: [u8; 32] = ${toBigEndian32(vk.vk_delta_2[0][1])};`);
console.log(`const VK_DELTA_Y0: [u8; 32] = ${toBigEndian32(vk.vk_delta_2[1][0])};`);
console.log(`const VK_DELTA_Y1: [u8; 32] = ${toBigEndian32(vk.vk_delta_2[1][1])};`);
console.log('');
console.log('// IC (Input Commitments)');
for (let i = 0; i < vk.IC.length; i++) {
    console.log(`const IC${i}_X: [u8; 32] = ${toBigEndian32(vk.IC[i][0])};`);
    console.log(`const IC${i}_Y: [u8; 32] = ${toBigEndian32(vk.IC[i][1])};`);
}
