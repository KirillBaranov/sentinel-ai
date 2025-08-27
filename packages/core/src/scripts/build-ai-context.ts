import { buildAIContext } from '../lib/context';

const profileDir = process.argv[2] || 'profiles/frontend';
const outFile = process.argv[3] || 'dist/ai-review-context.md';
buildAIContext(profileDir, outFile);
console.log(`Wrote ${outFile}`);