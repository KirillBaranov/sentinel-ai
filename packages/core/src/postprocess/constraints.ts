import type { Rule, RuleConstraint, RulesJson } from '../types'

export function deriveRuleConstraints(rules: RulesJson | null): RuleConstraint[] {
  if (!rules?.rules?.length) return []
  return rules.rules.map((r: Rule) => {
    const t: any = (r as any).trigger || {}
    return {
      id: String(r.id),
      area: r.area,
      severity: r.severity,
      evidence: t.evidence === 'diff-any' ? 'diff-any' : 'added-only',
      requireSignalMatch: !!t.requireSignalMatch,
      signals: Array.isArray(t.signals) ? t.signals.map(String) : [],
      exempt: Array.isArray(t.exempt) ? t.exempt.map(String) : [],
      file_glob: Array.isArray(t.file_glob) ? t.file_glob.map(String) : undefined,
    }
  })
}
