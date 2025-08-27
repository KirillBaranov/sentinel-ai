import fs from 'node:fs';
import path from 'node:path';

export function buildAIContext(profileDir: string, outFile: string) {
  const inputs = [
    'docs/rules/rules.yml',
    'docs/rules/boundaries.json',
    'docs/handbook/ARCHITECTURE.md',
    'docs/handbook/STYLEGUIDE.md',
    'docs/handbook/TESTING.md',
    'docs/handbook/ACCESSIBILITY.md',
    'docs/handbook/REVIEW_GUIDE.md'
  ];

  const read = (p: string) => {
    try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
  };

  const sections: string[] = [
    '# AI Review Context (Frontend)',
    '',
    '> Language: **Russian output required** (IDs/links stay in English)',
    '> DUAL OUTPUT REQUIRED: 1) YAML machine block first, 2) strict human blocks.',
    ''
  ];

  for (const rel of inputs) {
    const abs = path.join(profileDir, rel);
    if (!fs.existsSync(abs)) continue;
    sections.push('\n---\n');
    sections.push(`### ${rel}\n`);
    sections.push(read(abs));
  }

  const adrDir = path.join(profileDir, 'docs/adr');
  if (fs.existsSync(adrDir)) {
    const files = fs.readdirSync(adrDir).filter(f => f.endsWith('.md')).sort();
    for (const f of files) {
      sections.push('\n---\n');
      sections.push(`### docs/adr/${f}\n`);
      sections.push(read(path.join(adrDir, f)));
    }
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, sections.join('\n'), 'utf8');
}