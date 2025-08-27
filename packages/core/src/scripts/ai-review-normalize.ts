import { normalizeFile } from '../lib/normalize';

const inFile = process.argv[2] || 'dist/review.md';
const outFile = process.argv[3] || 'dist/review.normalized.md';
normalizeFile(inFile, outFile);
console.log(`Wrote ${outFile}`);