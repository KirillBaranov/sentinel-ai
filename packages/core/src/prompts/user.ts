import { addedLinesByFile, extractDiffFiles } from '../diff'
import type { ProviderReviewInput } from '../types'
import { formatRuleConstraints, ruleIds } from './system'
import { deriveRuleConstraints } from '../postprocess/constraints'

export function buildUserPrompt(input: ProviderReviewInput): string {
  const diff = input.diffText || ''
  const files = extractDiffFiles(diff)
  const ids = ruleIds(input.rules as any)
  const added = addedLinesByFile(diff)
  const constraints = deriveRuleConstraints(input.rules as any)

  const ctx =
    (input.context?.markdown || '')
      // keep prompt size sane
      .slice(0, input.context?.maxBytes ? Math.max(0, input.context.maxBytes) : 300_000)

  const diffFilesSection = files.length ? files.map((f) => `  - ${f}`).join('\n') : '  (none)'
  const addedSection = files
    .map((f) => {
      const rows = (added[f] || []).map((a) => `${a.line}: ${a.text}`).join('\n')
      return `# ${f}\n${rows || '(no added lines)'}\n`
    })
    .join('\n')

  const strictConstraints = [
    '- Report findings ONLY for files in DIFF_FILES.',
    '- Use ADDED lines as evidence unless a rule declares otherwise via "evidence".',
    '- Anchor each finding to actual lines with a precise locator.',
    '- Apply only the provided RULES; do not invent policies beyond them.',
    '- RULE_ID must be one of RULE_IDS exactly. If a rule cannot be satisfied under its constraints, do not report it.',
    '- When in doubt, return an empty findings list.',
  ].join('\n')

  const constraintsText = formatRuleConstraints(constraints)

  return [
    'STRICT CONSTRAINTS:',
    strictConstraints,
    '',
    `RULE_IDS:\n${ids.map((i) => `  - ${i}`).join('\n') || '  (none)'}`,
    '',
    `RULE_CONSTRAINTS (derived from rules.trigger):\n${constraintsText}`,
    '',
    'CONTEXT:',
    ctx,
    '',
    'DIFF_FILES:',
    diffFilesSection,
    '',
    'ADDED_LINES (per-file):',
    addedSection,
    '',
    'Return ONLY valid JSON (UTF-8), no markdown:',
    '{',
    '  "findings": [',
    '    {',
    '      "rule": "<one of RULE_IDS>",',
    '      "area": "string",',
    '      "severity": "critical|major|minor|info",',
    '      "file": "path/relative.ext",',
    '      "locator": "HUNK:@@ -a,b +c,d @@|Lnum|Lstart-Lend|symbol:Name",',
    '      "finding": ["[LOCATOR] message", "..."],',
    '      "why": "short explanation citing the matched evidence",',
    '      "suggestion": "short fix suggestion"',
    '    }',
    '  ]',
    '}',
  ].join('\n')
}
