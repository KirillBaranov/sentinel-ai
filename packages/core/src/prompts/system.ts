import type { RuleConstraint, RulesJson } from '../types'

export function buildSystemPrompt(): string[] {
  return [
    'You are a rigorous code review assistant.',
    'Use ONLY the provided RULES and CONTEXT (team handbook, boundaries, ADRs).',
    'Given a unified DIFF, produce findings strictly as JSON.',
    'Report ONLY issues explicitly evidenced in the DIFF under the constraints provided.',
    'Prefer ADDED lines (prefixed with "+") as evidence unless a rule declares a wider scope.',
    'Only report findings for files explicitly listed under DIFF_FILES.',
    '',
    'SIGNAL & EVIDENCE POLICY:',
    '- For a rule with `requireSignalMatch=true`, at least one of its `signals` must literally match applicable text according to `evidence`.',
    '- `evidence: "added-only"` → match inside ADDED lines.',
    '- `evidence: "diff-any"` → match inside the diff (provider may still prioritize ADDED lines).',
    '- Apply `exempt` patterns as allowlist: if an added line matches any `exempt` for the same rule, do not report it.',
    '',
    'OUTPUT RULES:',
    '- Each finding must include: rule, area, severity, file, locator, finding[], why, suggestion.',
    '- The "file" field MUST exactly match one of DIFF_FILES.',
    '- The "locator" must point to an added line or a hunk header (e.g., "HUNK:@@ -a,b +c,d @@", "L42", "L10-L20").',
    '- Each "finding[]" item must start with the locator in brackets, e.g. "[L45] message", and quote the triggering text.',
    '- If uncertain, return {"findings": []}.',
    'Return a single JSON object with the key "findings" (an array).',
  ]
}

export function formatRuleConstraints(rcs: RuleConstraint[]): string {
  if (!rcs.length) return '(none)'
  return rcs
    .map((rc) => {
      const lines: string[] = []
      lines.push(`- rule: ${rc.id}`)
      if (rc.area) lines.push(`  area: ${rc.area}`)
      if (rc.severity) lines.push(`  severity: ${rc.severity}`)
      lines.push(`  evidence: ${rc.evidence || 'added-only'}`)
      lines.push(`  requireSignalMatch: ${rc.requireSignalMatch ? 'true' : 'false'}`)
      if (rc.file_glob?.length) lines.push(`  file_glob:\n    - ${rc.file_glob.join('\n    - ')}`)
      if (rc.signals.length) lines.push(`  signals:\n    - ${rc.signals.join('\n    - ')}`)
      if (rc.exempt.length) lines.push(`  exempt:\n    - ${rc.exempt.join('\n    - ')}`)
      return lines.join('\n')
    })
    .join('\n')
}

export const rulesCompact = (rules?: RulesJson | null) =>
  rules
    ? {
        version: rules.version,
        domain: rules.domain,
        ruleCount: (rules.rules || []).length,
      }
    : null

export const ruleIds = (rules?: RulesJson | null): string[] =>
  (rules?.rules ?? []).map((r) => String(r.id))
