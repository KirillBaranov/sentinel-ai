import fs from 'node:fs'
import path from 'node:path'
import {
  parseUnifiedDiff,
  renderMarkdown,
  makeFingerprint,
  type ReviewFinding,
   type ReviewJson
   } from '@sentinel/core'

/**
 * Mock review runner — matches simple patterns in added lines.
 * Later this will call providers (OpenAI/Claude).
 */
export async function runReviewCLI(opts: {
  diff: string
  profile: string
  outJson: string
  outMd: string
}) {
  const diffPath = path.resolve(opts.diff)
  const diff = fs.readFileSync(diffPath, 'utf8')
  const files = parseUnifiedDiff(diff)

  const findings: ReviewFinding[] = []

  // Simple heuristic rules
  for (const f of files) {
    for (const h of f.hunks) {
      for (const add of h.added) {
        if (/TODO/i.test(add.text)) {
          const locator = `L${add.line}`
          findings.push({
            rule: 'style.no-todo-comment',
            severity: 'minor',
            file: f.filePath,
            locator,
            finding: [`[${locator}] TODO comment found: ${add.text.trim()}`],
            why: 'TODO comments should not remain in code.',
            suggestion: 'Track TODOs via issue tracker instead of inline comments.',
            fingerprint: makeFingerprint('style.no-todo-comment', f.filePath, locator, add.text.trim())
          })
        }
        if (/feature-b\\/internal/i.test(add.text)) {
          const locator = `L${add.line}`
          findings.push({
            rule: 'arch.modular-boundaries',
            severity: 'critical',
            file: f.filePath,
            locator,
            finding: [`[${locator}] Cross-feature internal import: ${add.text.trim()}`],
            why: 'Features must not import each other directly.',
            suggestion: 'Use a shared adapter or the feature’s public API instead.',
            fingerprint: makeFingerprint('arch.modular-boundaries', f.filePath, locator, add.text.trim())
          })
        }
      }
    }
  }

  const review: ReviewJson = {
    ai_review: {
      version: 1,
      run_id: `run_${Date.now()}`,
      findings
    }
  }

  fs.writeFileSync(opts.outJson, JSON.stringify(review, null, 2))
  fs.writeFileSync(opts.outMd, renderMarkdown(findings))

  console.log(`[review] wrote ${opts.outJson} (${findings.length} findings)`)
  console.log(`[review] wrote ${opts.outMd}`)
}
