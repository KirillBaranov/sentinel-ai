import { renderHuman } from '../lib/render-md';

const inFile = process.argv[2] || 'dist/review.normalized.md';
const outFile = process.argv[3] || 'dist/ai-review-human.md';
renderHuman(inFile, outFile);
console.log(`Wrote ${outFile}`);