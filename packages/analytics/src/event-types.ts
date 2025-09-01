import type { Severity } from '@sentinel/core'

export enum AnalyticsEventAction {
  ACCEPT = 'accept',
  DISMISS = 'dismiss',
  MUTE_RULE = 'mute_rule',
  ESCALATE = 'escalate',
}

export interface AnalyticsEventBase {
  ts: number
  run_id: string
}

export interface AnalyticsEventRunStarted extends AnalyticsEventBase {
  type: 'run.started'
  provider?: string
  profile?: string
  pr_id?: string
  commit_sha?: string
  repo?: string
}

export interface AnalyticsEventFindingReported extends AnalyticsEventBase {
  type: 'finding.reported'
  severity: Severity
  file_hash?: string
  locator?: string
  rule_id: string
}

export interface AnalyticsEventRunFinished extends AnalyticsEventBase {
  type: 'run.finished'
  duration_ms: number
  findings_total: number
  findings_by_severity: Partial<Record<Severity, number>>
  cost_tokens?: number
  cost_usd?: number
  ok: boolean
  impact_score?: number
}

export interface AnalyticsEventFeedbackGiven extends AnalyticsEventBase {
  type: 'feedback.given'
  rule_id: string
  action: AnalyticsEventAction
}

export type AnalyticsEvent =
  | AnalyticsEventRunStarted
  | AnalyticsEventFindingReported
  | AnalyticsEventRunFinished
  | AnalyticsEventFeedbackGiven
