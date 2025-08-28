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

export interface RulesJson {
  version: number
  domain: string
  metadata?: Record<string, unknown>
  rules: RuleItem[]
}
