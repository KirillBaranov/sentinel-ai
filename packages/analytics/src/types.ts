import type { Severity } from '@sentinel/core'

export * from './event-types'

export interface TrackRunStartedInput {
  run_id: string
  provider?: string
  profile?: string
  pr_id?: string
  commit_sha?: string
  repo?: string
}

export interface TrackFindingInput {
  run_id: string
  rule_id: string
  severity: Severity
  fileAbs?: string
  locator?: string
}

export interface TrackRunFinishedInput {
  run_id: string
  duration_ms: number
  findings_total: number
  findings_by_severity: Partial<Record<Severity, number>>
  cost_tokens?: number
  cost_usd?: number
  ok: boolean
  impact_score?: number
}

export interface AnalyticsConfig {
  enabled: boolean
  sink: 'file'
  fileDir?: string
  salt?: string
  runId?: string
}
