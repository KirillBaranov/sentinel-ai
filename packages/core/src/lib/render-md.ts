import fs from 'node:fs';
import crypto from 'node:crypto';
import { parse as yamlParse } from 'yaml';
import { extractYaml } from './normalize';

const sha1 = (s:string)=>crypto.createHash('sha1').update(s,'utf8').digest('hex');
const normPath = (p:string)=>p.replace(/^\.?\/*/,'').replace(/\\/g,'/');
const trunc = (s:string, max=160)=>s.length<=max?s:s.slice(0,max-1)+'…';

export function renderHuman(inFile: string, outFile: string) {
  const raw = fs.readFileSync(inFile,'utf8');
  const yml = extractYaml(raw);
  const doc = ((): any => {
    try { return JSON.parse(yml); } catch { return yamlParse(yml); }
  })();

  const findings = doc.ai_review.findings.map((f:any)=>({
    ...f,
    file: normPath(f.file),
    fingerprint: f.fingerprint && /^[a-f0-9]{40}$/.test(f.fingerprint)
      ? f.fingerprint : sha1(`${f.rule}|${normPath(f.file)}|${f.locator}`),
    finding: Array.isArray(f.finding)? f.finding : [String(f.finding)]
  }));

  const areaOrder = ['архитектура','тестирование','доступность','DX','производительность','нейминг'];
  findings.sort((a:any,b:any)=>
    (a.severity==='критично'?0:1)-(b.severity==='критично'?0:1) ||
    areaOrder.indexOf(a.area)-areaOrder.indexOf(b.area) ||
    a.rule.localeCompare(b.rule)
  );

  const blocks = findings.map((f:any, i:number)=>{
    const bullets = f.finding.map((s:string)=>`- ${s}`).join('\n');
    const fileLoc = f.line ? `${f.file}:${f.line}` : f.file;
    return [
      `### ${i+1}. ${f.rule} — ${fileLoc}`,
      `**Серьёзность:** ${f.severity}`,
      `**Область:** ${f.area}`,
      `**Правило:** ${f.rule} — ${f.link}`,
      ``,
      `**Находка:**`,
      bullets,
      ``,
      f.why ? `**Почему:** ${f.why}` : '',
      `**Предложение:** ${f.suggestion}`,
      ``,
      `<sub>locator: \`${trunc(f.locator)}\` • fp: \`${f.fingerprint}\`${f.symbol?` • symbol: \`${f.symbol}\``:''}</sub>`
    ].filter(Boolean).join('\n');
  }).join('\n\n---\n\n');

  const out = `## 🤖 Автоматический Code Review (advisory)\n\n${blocks}\n`;
  fs.mkdirSync(require('path').dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, out, 'utf8');
}