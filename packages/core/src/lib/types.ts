export type Severity = 'critical' | 'major' | 'minor' | 'info'

export interface RuleItem {
  id: string
  area: string
  severity: Severity
  description: string
  link: string
  examples?: Record<string, string[]>
  scope?: ('changed' | 'file' | 'module' | 'project')[]
  trigger?: {
    type: 'pattern' | 'heuristic' | 'llm' | 'hybrid'
    signals?: string[]
  }
  status?: 'active' | 'experimental' | 'deprecated'
  version?: number
  experiments?: Record<string, unknown>
  ask_feedback?: boolean
}

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

export interface RulesJson {
  version: number
  domain: string
  metadata?: Record<string, unknown>
  rules: RuleItem[]
}

export interface ReviewJson {
  ai_review: {
    version: 1
    run_id: string
    findings: ReviewFinding[]
  }
}
