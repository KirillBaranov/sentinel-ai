import type { ReviewFinding, Severity } from '../types'

type HTMLOptions = {
  includeStyles?: boolean
  groupByFile?: boolean
  title?: string
}

const sevColor: Record<Severity, string> = {
  critical: '#b91c1c', // red-700
  major: '#c2410c',    // orange-700
  minor: '#065f46',    // emerald-800
  info: '#1e3a8a',     // blue-800
}

const sevOrder: Record<Severity, number> = { critical: 3, major: 2, minor: 1, info: 0 }

function sortFindings(a: ReviewFinding, b: ReviewFinding): number {
  const sev = sevOrder[b.severity] - sevOrder[a.severity]
  if (sev) return sev
  const fa = (a.file || '').localeCompare(b.file || '')
  if (fa) return fa
  const num = (s: string) => {
    const m = s?.match(/\d+/)
    return m ? parseInt(m[0]!, 10) : Number.MAX_SAFE_INTEGER
    }
  return num(a.locator || '') - num(b.locator || '')
}

function esc(s: string): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function styles(): string {
  return `
<style>
  :root { --bg:#0b0f14; --panel:#0f172a; --muted:#94a3b8; --fg:#e2e8f0; --border:#1f2937; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica Neue, Arial, "Apple Color Emoji", "Segoe UI Emoji"; color: var(--fg); }
  .wrap { max-width: 1100px; margin: 24px auto; padding: 0 16px; }
  h1 { font-size: 24px; margin: 0 0 16px; }
  .meta { color: var(--muted); margin-bottom: 20px; }
  .grid { display: grid; grid-template-columns: 1fr; gap: 12px; }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; }
  .file { font-weight: 600; color: var(--fg); margin: 24px 0 8px; }
  .badge { display: inline-block; font-size: 12px; font-weight: 700; padding: 2px 8px; border-radius: 999px; margin-left: 8px; color: #fff; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
  .loc { color: var(--muted); }
  .evidence { margin: 8px 0 0 0; padding-left: 18px; }
  .section { margin-top: 24px; }
  .muted { color: var(--muted); }
  .kv { display:flex; flex-wrap:wrap; gap:8px 16px; margin-top:6px; }
  .kv div { white-space: pre-wrap; }
  .fp { color: var(--muted); font-size: 12px; margin-top: 8px; }
</style>`
}

function header(title: string, total: number, counts: Record<Severity, number>): string {
  return `
  <h1>${esc(title)}</h1>
  <div class="meta mono">Всего находок: <strong>${total}</strong> · critical: <strong>${counts.critical || 0}</strong> · major: <strong>${counts.major || 0}</strong> · minor: <strong>${counts.minor || 0}</strong> · info: <strong>${counts.info || 0}</strong></div>
  `
}

function badge(sev: Severity): string {
  return `<span class="badge" style="background:${sevColor[sev]}">${sev.toUpperCase()}</span>`
}

function renderFinding(f: ReviewFinding): string {
  const evidence =
    Array.isArray(f.finding) && f.finding.length
      ? `<ul class="evidence">${f.finding.map((l) => `<li class="mono">${esc(l)}</li>`).join('')}</ul>`
      : `<div class="muted">нет строк-доказательств</div>`
  return `
  <div class="card">
    <div><strong>${esc(f.rule)}</strong> ${badge(f.severity)}</div>
    <div class="kv">
      <div class="mono">file: ${esc(f.file || '(unknown)')}</div>
      <div class="mono loc">locator: ${esc(f.locator || 'L0')}</div>
      <div>area: ${esc(f.area || 'general')}</div>
    </div>
    <div class="section"><div class="muted">Why</div><div>${esc(f.why || '')}</div></div>
    <div class="section"><div class="muted">Suggestion</div><div>${esc(f.suggestion || '')}</div></div>
    <div class="section"><div class="muted">Evidence</div>${evidence}</div>
    <div class="fp mono">fingerprint: ${esc(f.fingerprint)}</div>
  </div>`
}

export function renderHtml(findings: ReviewFinding[] = [], opts: HTMLOptions = {}): string {
  const includeStyles = opts.includeStyles !== false
  const title = opts.title ?? 'Sentinel — Findings'
  const list = [...(findings || [])].sort(sortFindings)

  const counts = { critical: 0, major: 0, minor: 0, info: 0 } as Record<Severity, number>
  for (const f of list) counts[f.severity] = (counts[f.severity] || 0) + 1

  const empty = !list.length
    ? `<div class="card"><strong>✅ Нарушений не обнаружено.</strong></div>`
    : ''

  let content = ''

  if (opts.groupByFile) {
    const byFile = new Map<string, ReviewFinding[]>()
    for (const f of list) {
      const k = f.file || '(unknown)'
      if (!byFile.has(k)) byFile.set(k, [])
      byFile.get(k)!.push(f)
    }

    const sections: string[] = []
    for (const [file, arrRaw] of byFile.entries()) {
      const arr = arrRaw.sort(sortFindings)
      sections.push(
        `<div class="file">${esc(file)} <span class="muted">(${arr.length})</span></div>` +
          `<div class="grid">${arr.map(renderFinding).join('')}</div>`,
      )
    }
    content = sections.join('\n')
  } else {
    content = `<div class="grid">${list.map(renderFinding).join('')}</div>`
  }

  const html = `
<div class="wrap">
  ${header(title, list.length, counts)}
  ${empty || content}
</div>`

  return includeStyles ? `${styles()}\n${html}` : html
}

export default renderHtml
