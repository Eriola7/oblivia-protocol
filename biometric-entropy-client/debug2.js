const { quantizeFeatures } = require('./fuzzyExtractor');

const b1 = [0.82, 0.45, 0.91, 0.33, 0.76, 0.54, 0.88, 0.21, 0.67, 0.43,
            0.79, 0.55, 0.83, 0.31, 0.72, 0.49, 0.85, 0.28, 0.64, 0.41];

const b2 = [0.83, 0.44, 0.92, 0.34, 0.77, 0.53, 0.87, 0.22, 0.68, 0.44,
            0.80, 0.54, 0.84, 0.32, 0.73, 0.48, 0.86, 0.29, 0.65, 0.42];

const bucketSize = 64;
const q1 = quantizeFeatures(b1).map(v => Math.round(v/bucketSize)*bucketSize);
const q2 = quantizeFeatures(b2).map(v => Math.round(v/bucketSize)*bucketSize);

console.log("Corrected 1:", q1);
console.log("Corrected 2:", q2);
console.log("Mismatches:", q1.map((v,i) => v !== q2[i] ? `index ${i}: ${v} vs ${q2[i]}` : null).filter(Boolean));
