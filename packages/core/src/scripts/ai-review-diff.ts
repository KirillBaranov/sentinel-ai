import { diffCurrentAgainstPrev } from '../lib/diff';

const cur = process.argv[2] || 'dist/review.normalized.md';
const prev = process.argv[3] || 'dist/ai-review-prev.json';
diffCurrentAgainstPrev(cur, prev);