import type { ReviewFinding } from './types.js';
import { DEFAULT_SEVERITY_MAP, type RenderOptions, type Severity } from './render-config.js';

type Grouped = Record<Severity, ReviewFinding[]>;

function groupFindings(findings: ReviewFinding[], order: Severity[]): Grouped {
  const g: Grouped = { critical: [], major: [], minor: [], info: [] };
  for (const f of findings) g[f.severity as Severity]?.push(f);
  for (const key of Object.keys(g) as Severity[]) {
    g[key].sort((a,b) =>
      (a.area || '').localeCompare(b.area || '') ||
      (a.file || '').localeCompare(b.file || '')
    );
  }
  const out: Grouped = { critical: [], major: [], minor: [], info: [] };
  for (const s of order) out[s] = g[s];
  return out;
}

function applySimpleTemplate(tpl: string, ctx: Record<string, string>) {
  return tpl.replace(/\{\{\s*([.\w]+)\s*\}\}/g, (_, k) => ctx[k] ?? '');
}

export function renderMarkdown(
  findings: ReviewFinding[],
  opts: RenderOptions = {}
): string {
  const map = { ...DEFAULT_SEVERITY_MAP, ...(opts.severityMap || {}) };
  const order = map.order ?? DEFAULT_SEVERITY_MAP.order!;
  const grouped = groupFindings(findings, order);

  if (opts.template) {
    const lines: string[] = ['# Sentinel AI Review'];
    for (const s of order) {
      const label = `${map.icon?.[s] ? map.icon![s] + ' ' : ''}${map.title[s]}`;
      lines.push(`\n## ${label}`);
      if (grouped[s].length === 0) { lines.push(`- ✅ No issues found`); continue; }
      for (const f of grouped[s]) {
        const ctx = {
          severity: s,
          severity_title: map.title[s],
          severity_icon: map.icon?.[s] ?? '',
          rule: f.rule,
          area: f.area ?? '',
          file: f.file ?? '',
          locator: f.locator ?? '',
          what: f.finding?.[0] ?? '',
          why: f.why ?? '',
          suggestion: f.suggestion ?? '',
          fingerprint: f.fingerprint ?? '',
        };
        lines.push(applySimpleTemplate(opts.template!, ctx));
      }
    }
    return lines.join('\n');
  }

  const out: string[] = ['# Sentinel AI Review'];
  for (const s of order) {
    const label = `${map.icon?.[s] ? map.icon![s] + ' ' : ''}${map.title[s]}`;
    out.push(`\n## ${label}`);
    const arr = grouped[s];
    if (arr.length === 0) { out.push(`- ✅ No issues found`); continue; }

    const byArea = new Map<string, ReviewFinding[]>();
    for (const f of arr) {
      const k = `${f.area || 'General'}|${f.file || ''}`;
      const list = byArea.get(k) ?? [];
      list.push(f); byArea.set(k, list);
    }
    for (const [k, list] of byArea) {
      const [, file] = k.split('|');
      const ruleId = list[0].rule;
      out.push(`- **${ruleId}** in \`${file || '—'}\``);
      for (const f of list) {
        const what = f.finding?.[0] ?? '';
        out.push(`  - ${what}`);
        if (f.why) out.push(`  - _Why:_ ${f.why}`);
        if (f.suggestion) out.push(`  - _Fix:_ ${f.suggestion}`);
      }
    }
  }
  return out.join('\n');
}
