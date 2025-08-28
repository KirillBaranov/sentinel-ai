import type { ReviewFinding } from './normalize.js'
import { groupBySeverity } from './normalize.js'

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Render human-facing Markdown grouped by severity → files.
 * Keeps wording concise and action-oriented.
 */
export function renderMarkdown(findings: ReviewFinding[]): string {
  const { order, map } = groupBySeverity(findings)
  const lines: string[] = []

  lines.push('# Sentinel AI Review — frontend')

  for (const sev of order) {
    const bucket = map.get(sev)!
    const icon =
      sev === 'critical' ? '🛑' :
      sev === 'major'    ? '⚠️' :
      sev === 'minor'    ? '💡' : '🛈'

    lines.push('', `## ${icon} ${capitalize(sev)}`)

    if (bucket.length === 0) {
      lines.push('- ✅ No issues found')
      continue
    }

    // Group by file path for readability
    const byFile = new Map<string, ReviewFinding[]>()
    for (const f of bucket) {
      if (!byFile.has(f.file)) byFile.set(f.file, [])
      byFile.get(f.file)!.push(f)
    }

    for (const [file, list] of byFile) {
      for (const f of list) {
        lines.push(`- **${f.rule}** in \`${file}\``)
        for (const item of f.finding) lines.push(`  - ${item}`)
        lines.push(`  - Why: ${f.why}`)
        lines.push(`  - Fix: ${f.suggestion}`)
      }
    }
  }

  lines.push('', '---', 'Feedback: 👍 Relevant | 👎 Noisy (explain)')
  return lines.join('\n')
}
