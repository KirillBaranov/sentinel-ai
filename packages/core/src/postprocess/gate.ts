import type { ReviewFinding, RulesJson } from '../types'
import { deriveRuleConstraints } from './constraints'
import { anyMatch, anyExempt } from './matchers'
import type { ParsedDiff } from '../diff'

export function normalizeAndGate(
  raw: any[],
  diff: ParsedDiff,
  rules: RulesJson | null
): ReviewFinding[] {
  const ids = new Set((rules?.rules ?? []).map(r => String(r.id)))
  const constraints = deriveRuleConstraints(rules)
  const out: ReviewFinding[] = []

  for (const itRaw of raw || []) {
    const it = itRaw || {}
    const base: ReviewFinding = {
      rule: String(it.rule || ''),
      area: String(it.area || ''),
      severity: (['critical','major','minor','info'] as const).includes(it.severity) ? it.severity : 'minor',
      file: String(it.file || ''),
      locator: String(it.locator || ''),
      finding: Array.isArray(it.finding) ? it.finding.map(String) : [],
      why: String(it.why || ''),
      suggestion: String(it.suggestion || ''),
      fingerprint: '',
    }

    if (!base.rule || !ids.has(base.rule)) continue
    if (!base.file || !diff.files.includes(base.file)) continue

    const rc = constraints.find(c => c.id === base.rule)
    const addedTexts = (diff.addedByFile[base.file] || []).map(a => a.text)

    if (rc?.requireSignalMatch) {
      const isExempt = rc.exempt?.length ? anyExempt(addedTexts, rc.exempt) : false
      const hasSignal = rc.signals?.length ? anyMatch(addedTexts, rc.signals) : false
      if (isExempt || !hasSignal) continue
    }

    if (base.finding?.length) {
      const ok = base.finding.some(msg => {
        const stripped = String(msg).replace(/^\[[^\]]+\]\s*/, '')
        return addedTexts.some(line => stripped.includes(line.slice(0, Math.min(20, line.length))))
      })
      if (!ok) continue
    }

    base.fingerprint = JSON.stringify({
      rule: base.rule, file: base.file, locator: base.locator, finding: base.finding
    })

    out.push(base)
  }

  return out
}
