import type { ReviewFinding, Severity } from '../types'

type MDOptions = {
  groupByFile?: boolean
  title?: string
}

const sevOrder: Record<Severity, number> = { critical: 3, major: 2, minor: 1, info: 0 }

function sortFindings(a: ReviewFinding, b: ReviewFinding): number {
  const sev = sevOrder[b.severity] - sevOrder[a.severity]
  if (sev) return sev
  const fa = (a.file || '').localeCompare(b.file || '')
  if (fa) return fa
  // try to sort numerically by first number in locator like "L42" / "L10-L20"
  const num = (s: string) => {
    const m = s?.match(/\d+/)
    return m ? parseInt(m[0]!, 10) : Number.MAX_SAFE_INTEGER
  }
  return num(a.locator || '') - num(b.locator || '')
}

function mdEscapeInline(s: string): string {
  // минимально: экранируем | * _ ` и \
  return (s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/`/g, '\\`')
}

function formatHeader(title: string, total: number, counts: Record<Severity, number>): string {
  const parts = [
    `# ${title}`,
    '',
    `Всего находок: **${total}**`,
    `- critical: **${counts.critical || 0}**`,
    `- major: **${counts.major || 0}**`,
    `- minor: **${counts.minor || 0}**`,
    `- info: **${counts.info || 0}**`,
    '',
  ]
  return parts.join('\n')
}

export function renderMarkdown(findings: ReviewFinding[] = [], opts: MDOptions = {}): string {
  const title = opts.title ?? 'Sentinel — Findings'
  const list = [...(findings || [])].sort(sortFindings)

  const counts = { critical: 0, major: 0, minor: 0, info: 0 } as Record<Severity, number>
  for (const f of list) counts[f.severity] = (counts[f.severity] || 0) + 1

  if (!list.length) {
    return `${formatHeader(title, 0, counts)}> ✅ Нарушений не обнаружено.`
  }

  if (opts.groupByFile) {
    const byFile = new Map<string, ReviewFinding[]>()
    for (const f of list) {
      const k = f.file || '(unknown)'
      if (!byFile.has(k)) byFile.set(k, [])
      byFile.get(k)!.push(f)
    }
    const sections: string[] = []
    sections.push(formatHeader(title, list.length, counts))

    for (const [file, arrRaw] of byFile.entries()) {
      const arr = arrRaw.sort(sortFindings)
      sections.push(`## ${mdEscapeInline(file)} (${arr.length})\n`)
      for (const f of arr) {
        sections.push(
          [
            `### ${mdEscapeInline(f.rule)} — **${f.severity}**`,
            `**File:** ${mdEscapeInline(f.file || '(unknown)')}  `,
            `**Locator:** \`${mdEscapeInline(f.locator || 'L0')}\`  `,
            `**Area:** ${mdEscapeInline(f.area || 'general')}`,
            '',
            '**Evidence:**',
            ...(Array.isArray(f.finding) && f.finding.length
              ? f.finding.map((l) => `- ${mdEscapeInline(l)}`)
              : ['- _(no evidence lines provided)_']),
            '',
            `**Why:** ${mdEscapeInline(f.why || '')}`,
            `**Suggestion:** ${mdEscapeInline(f.suggestion || '')}`,
            '',
            `Fingerprint: \`${mdEscapeInline(f.fingerprint)}\``,
            '',
          ].join('\n'),
        )
      }
    }
    return sections.join('\n')
  }

  // плоский вывод
  const lines: string[] = []
  lines.push(formatHeader(title, list.length, counts))
  for (const f of list) {
    lines.push(
      [
        `## ${mdEscapeInline(f.rule)} — **${f.severity}**`,
        `**File:** ${mdEscapeInline(f.file || '(unknown)')}  `,
        `**Locator:** \`${mdEscapeInline(f.locator || 'L0')}\`  `,
        `**Area:** ${mdEscapeInline(f.area || 'general')}`,
        '',
        '**Evidence:**',
        ...(Array.isArray(f.finding) && f.finding.length
          ? f.finding.map((l) => `- ${mdEscapeInline(l)}`)
          : ['- _(no evidence lines provided)_']),
        '',
        `**Why:** ${mdEscapeInline(f.why || '')}`,
        `**Suggestion:** ${mdEscapeInline(f.suggestion || '')}`,
        '',
        `Fingerprint: \`${mdEscapeInline(f.fingerprint)}\``,
        '',
      ].join('\n'),
    )
  }
  return lines.join('\n')
}

export default renderMarkdown
