import fs from 'node:fs';
import path from 'node:path';

export function ensureDirForFile(p: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}
