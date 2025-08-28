import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ReviewJson, ReviewFinding } from '@sentinel/core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../../../../')

const ICON = {
  critical: '🛑',
  major: '⚠️',
  minor: '💡',
  info: '🛈'
} as const

type Sev = keyof typeof ICON

function groupBy<T, K extends string>(arr: T[], by: (x: T) => K) {
  return arr.reduce((acc, item) => {
    const k = by(item)
    ;(acc[k] ||= []).push(item)
    return acc
  }, {} as Record<K, T[]>)
}

function orderSev(a: Sev, b: Sev) {
  const rank: Record<Sev, number> = { critical: 0, major: 1, minor: 2, info: 3 }
  return rank[a] - rank[b]
}

function renderSection(sev: Sev, items: ReviewFinding[]) {
  const icon = ICON[sev]
  const title = sev[0].toUpperCase() + sev.slice(1)
  if (items.length === 0) {
    return `## ${icon} ${title}\n- ✅ No issues found\n`
  }
  // group by area
  const byArea = groupBy(items, f => (f.area || 'General') as string)
  const areas = Object.keys(byArea).sort((a, b) => a.localeCompare(b))
  const chunks: string[] = [`## ${icon} ${title}`]
  for (const area of areas) {
    chunks.push(`- **${area}**`)
    for (const f of byArea[area]) {
      const loc = f.locator ? ` ${f.locator}` : ''
      chunks.push(
        `  - **${f.rule}** in \`${f.file}\`${loc}`,
        ...f.finding.map(line => `    - ${line}`),
        f.why ? `    - Why: ${f.why}` : '',
        f.suggestion ? `    - Fix: ${f.suggestion}` : ''
      )
    }
  }
  return chunks.filter(Boolean).join('\n') + '\n'
}

export function renderMarkdownFromJson(json: ReviewJson) {
  const findings = json.ai_review?.findings ?? []
  const bySev = groupBy(findings, f => (f.severity as Sev) || 'minor')

  const sectionsOrder: Sev[] = ['critical', 'major', 'minor', 'info']
  const body = sectionsOrder
    .sort(orderSev)
    .map(sev => renderSection(sev, bySev[sev] || []))
    .join('\n')

  const header = `# Sentinel AI Review — ${json.ai_review?.run_id ?? 'run'}\n`
  return `${header}\n${body}\n---\nFeedback: 👍 Relevant | 👎 Noisy (explain)\n`
}

export async function renderMdCLI(opts: { inFile: string; outFile: string }) {
  const inAbs = path.isAbsolute(opts.inFile) ? opts.inFile : path.join(REPO_ROOT, opts.inFile)
  const outAbs = path.isAbsolute(opts.outFile) ? opts.outFile : path.join(REPO_ROOT, opts.outFile)
  const raw = fs.readFileSync(inAbs, 'utf8')
  const json = JSON.parse(raw) as ReviewJson
  const md = renderMarkdownFromJson(json)
  fs.mkdirSync(path.dirname(outAbs), { recursive: true })
  fs.writeFileSync(outAbs, md)
  console.log(`[render-md] wrote ${path.relative(REPO_ROOT, outAbs)}`)
}
