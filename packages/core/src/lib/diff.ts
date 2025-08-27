import fs from 'node:fs';
import crypto from 'node:crypto';
import { parse as yamlParse } from 'yaml';
import { extractYaml } from './normalize';
const sha1 = (s:string)=>crypto.createHash('sha1').update(s,'utf8').digest('hex');
const normPath=(p:string)=>p.replace(/^\.?\/*/,'').replace(/\\/g,'/');

export function diffCurrentAgainstPrev(curMd: string, prevJson: string) {
  const raw = fs.readFileSync(curMd,'utf8');
  const yml = extractYaml(raw);
  const doc = ((): any => {
    try { return JSON.parse(yml); } catch { return yamlParse(yml); }
  })();
  const now = (doc.ai_review.findings||[]).map((f:any)=>{
    const fp = f.fingerprint && /^[a-f0-9]{40}$/.test(f.fingerprint)
      ? f.fingerprint : sha1(`${f.rule}|${normPath(f.file)}|${f.locator}`);
    return { ...f, file: normPath(f.file), fingerprint: fp };
  });
  const prev = fs.existsSync(prevJson) ? JSON.parse(fs.readFileSync(prevJson,'utf8')) : [];
  const prevMap: Record<string, any> = Object.fromEntries(prev.map((f:any)=>[f.fingerprint, f]));
  const nowMap: Record<string, any> = Object.fromEntries(now.map((f:any)=>[f.fingerprint, f]));

  const added = now.filter((f:any)=>!prevMap[f.fingerprint]);
  const removed = prev.filter((f:any)=>!nowMap[f.fingerprint]);
  const unchanged = now.filter((f:any)=>prevMap[f.fingerprint]);

  fs.writeFileSync('dist/ai-review-prev.json', JSON.stringify(now,null,2));
  fs.writeFileSync('dist/ai-review-diff.json', JSON.stringify({added,removed,unchanged},null,2));
}