import { parseUnifiedDiff } from './diff'
import { makeFingerprint } from './normalize'
import type { RulesJson, RuleItem, ReviewFinding } from './types'
import type { BoundariesConfig } from './boundaries'
import { extractImportSpecifier, checkForbidden, toPosix } from './boundaries'

export type EngineInput = {
  diffText: string
  rulesById?: Map<string, RuleItem>
  rulesJson?: RulesJson | null
  boundaries?: BoundariesConfig | null
}

export function defaultMetaFor(
  ruleId: string,
  rules: Map<string, RuleItem> | undefined
): { area: string; severity: 'critical' | 'major' | 'minor' | 'info' } {
  const r = rules?.get(ruleId)
  if (r) return { area: r.area, severity: r.severity }
  return { area: 'Style', severity: 'minor' }
}

export function analyzeDiff(input: EngineInput): ReviewFinding[] {
  const files = parseUnifiedDiff(input.diffText)
  const rulesById = input.rulesById
  const findings: ReviewFinding[] = []

  for (const f of files) {
    for (const h of f.hunks) {
      for (const add of h.added) {
        const text = add.text

        // style.no-todo-comment
        if (/^\s*\/\/\s*TODO\b/i.test(text) || /\/\*\s*TODO[\s:*]/i.test(text)) {
          const ruleId = 'style.no-todo-comment'
          const locator = `L${add.line}`
          const meta = defaultMetaFor(ruleId, rulesById)
          const first = text.trim()

          findings.push({
            rule: ruleId,
            area: meta.area,
            severity: meta.severity,
            file: f.filePath,
            locator,
            finding: [`[${locator}] TODO comment found: ${first}`],
            why: 'Inline TODOs get stale and hide tech debt.',
            suggestion: 'Replace with a link to a tracked ticket (issue/ID) and remove the inline TODO.',
            fingerprint: makeFingerprint(ruleId, f.filePath, locator, first),
          })
        }

        // arch.modular-boundaries (простая эвристика)
        if (
          /\bfrom\s+['"]feature-[^'"]+\/internal(?:\/|['"])/i.test(text) ||
          /import\s+[^;]*['"]feature-[^'"]+\/internal(?:\/|['"])/i.test(text)
        ) {
          const ruleId = 'arch.modular-boundaries'
          const locator = `L${add.line}`
          const meta = defaultMetaFor(ruleId, rulesById)
          const first = text.trim()

          findings.push({
            rule: ruleId,
            area: meta.area,
            severity: meta.severity,
            file: f.filePath,
            locator,
            finding: [`[${locator}] Cross-feature internal import: ${first}`],
            why: 'Features must not import each other directly; this couples internals.',
            suggestion: 'Use a shared adapter/port or the feature public API (e.g., feature-b/public-api).',
            fingerprint: makeFingerprint(ruleId, f.filePath, locator, first),
          })
        }

        // boundaries.json (если есть)
        if (input.boundaries) {
          const spec = extractImportSpecifier(text)
          if (spec) {
            const fromFilePosix = toPosix(f.filePath)
            const hits = checkForbidden({ fromFile: fromFilePosix, specifier: spec }, input.boundaries)
            for (const r of hits) {
              const ruleId = `boundaries.${r.rule}`
              const locator = `L${add.line}`
              const meta = defaultMetaFor(ruleId, rulesById)
              const first = text.trim()

              findings.push({
                rule: ruleId,
                area: meta.area,
                severity: meta.severity,
                file: f.filePath,
                locator,
                finding: [`[${locator}] Forbidden import per boundaries: \`${spec}\``],
                why: r.explain || 'Import violates module boundaries policy.',
                suggestion: 'Use allowed adapter/port (see handbook/boundaries).',
                fingerprint: makeFingerprint(ruleId, f.filePath, locator, first),
              })
            }
          }
        }
      }
    }
  }

  return findings
}
