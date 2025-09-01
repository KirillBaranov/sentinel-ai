import fs from 'node:fs'
import path from 'node:path'
import type { ReviewJson, ReviewFinding } from '@sentinel/core'
import {
  findRepoRoot,
  ensureDirForFile,
  printRenderSummaryMarkdown,
} from '../cli-utils.js'

const REPO_ROOT = findRepoRoot()

const ICON = {
  critical: '🛑',
  major: '⚠️',
  minor: '💡',
  info: '🛈',
} as const

type Sev = keyof typeof ICON

function groupBy<T, K extends string>(arr: T[], by: (x: T) => K) {
  return arr.reduce((acc, item) => {
    const k = by(item)
    ;(acc[k] ||= []).push(item)
    return acc
  }, {} as Record<K, T[]>)
}

function renderSection(sev: Sev, items: ReviewFinding[]) {
  const icon = ICON[sev]
  const title = sev?.[0]?.toUpperCase() + sev?.slice(1)

  if (!items || items.length === 0) {
    return `## ${icon} ${title}\n- ✅ No issues found\n`
  }

  // group by area
  const byArea = groupBy(items, (f) => (f.area || 'General') as string)
  const areas = Object.keys(byArea).sort((a, b) => a.localeCompare(b))

  const chunks: string[] = [`## ${icon} ${title}`]
  for (const area of areas) {
    chunks.push(`- **${area}**`)
    for (const f of byArea?.[area] ?? []) {
      const loc = f.locator ? ` ${f.locator}` : ''
      const lines: string[] = [
        `  - **${f.rule}** in \`${f.file}\`${loc}`,
        ...((f.finding ?? []).map((line) => `    - ${line}`)),
      ]
      if (f.why) lines.push(`    - Why: ${f.why}`)
      if (f.suggestion) lines.push(`    - Fix: ${f.suggestion}`)
      chunks.push(...lines)
    }
  }
  return chunks.join('\n') + '\n'
}

export function renderMarkdownFromJson(json: ReviewJson) {
  const findings = json.ai_review?.findings ?? []
  // safe map severity → Sev (fallback: minor)
  const sev = ['critical', 'major', 'minor', 'info']
  const bySev = groupBy(
    findings,
    (f) => (sev.includes(String(f.severity)) ? (f.severity as Sev) : 'minor')
  )

  const order: Sev[] = ['critical', 'major', 'minor', 'info']
  const body = order.map((s) => renderSection(s, bySev[s] || [])).join('\n')

  const header = `# Sentinel AI Review — ${json.ai_review?.run_id ?? 'run'}\n`
  return `${header}\n${body}\n---\nFeedback: 👍 Relevant | 👎 Noisy (explain)\n`
}

export async function renderMdCLI(opts: { inFile: string; outFile: string }) {
  const inAbs  = path.isAbsolute(opts.inFile)  ? opts.inFile  : path.join(REPO_ROOT, opts.inFile)
  const outAbs = path.isAbsolute(opts.outFile) ? opts.outFile : path.join(REPO_ROOT, opts.outFile)

  const raw = fs.readFileSync(inAbs, 'utf8')
  const json = JSON.parse(raw) as ReviewJson

  const md = renderMarkdownFromJson(json)
  ensureDirForFile(outAbs)
  fs.writeFileSync(outAbs, md, 'utf8')

  // unified summary
  printRenderSummaryMarkdown({
    repoRoot: REPO_ROOT,
    inFile: inAbs,
    outFile: outAbs,
    findingsCount: json.ai_review?.findings?.length ?? 0,
  })
}
