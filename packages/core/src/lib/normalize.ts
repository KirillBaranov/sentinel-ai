import fs from 'node:fs';
import { parse as yamlParse } from 'yaml';

export type Finding = {
  rule: string; link: string;
  severity: 'критично'|'рекомендация';
  area: string; file: string;
  line?: number; symbol?: string;
  locator: string; fingerprint?: string;
  finding: string[] | string;
  why?: string; suggestion: string;
  status?: 'open'|'resolved';
};

export function extractYaml(md: string): string {
  const fenced = md.match(/```yaml\s*([\s\S]*?)\s*```/i);
  if (fenced) return fenced[1].trim();
  const start = md.indexOf('ai_review:');
  if (start === -1) throw new Error('YAML block not found');
  const tail = md.slice(start);
  const lines = tail.split(/\r?\n/);
  const endMarkers = [/^```/, /^##\s/, /^#\s/, /^🤖/, /^-{3,}\s*$/];
  let end = lines.length;
  for (let i = 1; i < lines.length; i++) {
    if (endMarkers.some(re => re.test(lines[i]))) { end = i; break; }
  }
  return lines.slice(0, end).join('\n').trim();
}

export function normalizeMachineYaml(yamlStr: string) {
  const doc = yamlParse(yamlStr) as any;
  if (!doc?.ai_review?.findings) throw new Error('Invalid schema: ai_review.findings missing');
  const arr = doc.ai_review.findings as Finding[];
  for (const f of arr) {
    if (typeof f.finding === 'string') f.finding = [f.finding];
  }
  return { ai_review: { ...doc.ai_review, findings: arr } };
}

export function normalizeFile(inFile: string, outFile: string) {
  const raw = fs.readFileSync(inFile, 'utf8');
  const yml = extractYaml(raw);
  const norm = normalizeMachineYaml(yml);
  const out = '```yaml\n' + JSON.stringify(norm, null, 2) + '\n```\n';
  fs.mkdirSync(require('path').dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, out, 'utf8');
}