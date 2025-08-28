import crypto from 'node:crypto'
import type { Severity } from './types.js'

export interface ReviewFinding {
  rule: string
  area: string
  severity: Severity
  file: string
  /**
   * Locator priority: HUNK:@@ ... @@ | Lnum | Lstart-Lend | symbol:Name
   */
  locator: string
  /**
   * Каждая строка начинается с локатора:
   * [L45-L53] message
   * [HUNK:@@ -12,7 +12,9 @@] message
   * [symbol:FooBar] message
   */
  finding: string[]
  why: string
  suggestion: string
  /**
   * Stable identifier for the finding:
   * sha1(rule + '\n' + file + '\n' + locator + '\n' + firstFinding)
   */
  fingerprint: string
}

export interface ReviewJson {
  ai_review: {
    version: 1
    run_id: string
    findings: ReviewFinding[]
  }
}

/** Группировка по severity в каноническом порядке */
export function groupBySeverity(findings: ReviewFinding[]) {
  const order: Severity[] = ['critical', 'major', 'minor', 'info']
  const map = new Map<Severity, ReviewFinding[]>()
  for (const s of order) map.set(s, [])
  for (const f of findings) map.get(f.severity)!.push(f)
  return { order, map }
}

/** SHA1 helper (для fingerprint) */
export function sha1(content: string): string {
  return crypto.createHash('sha1').update(content).digest('hex')
}

/** Детерминированный fingerprint */
export function makeFingerprint(
  rule: string,
  file: string,
  locator: string,
  firstFinding: string
): string {
  return sha1(`${rule}\n${file}\n${locator}\n${firstFinding}`)
}
