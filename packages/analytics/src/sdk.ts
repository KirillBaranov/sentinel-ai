import path from 'node:path'
import type { Severity } from '@sentinel/core'
import { FileSink } from './sink/file'
import { hashPath } from './hash'
import type {
  AnalyticsConfig,
  AnalyticsEvent,
} from './types'

let cfg: AnalyticsConfig | null = null
let sink: FileSink | null = null
let repoRootMemo = ''
let saltMemo: string | undefined
let runIdMemo: string | null = null

export function initAnalytics(c: Partial<AnalyticsConfig> | undefined, repoRoot: string, runId?: string) {
  const enabled = !!c?.enabled
  if (!enabled) {
    cfg = { enabled: false, sink: 'file' }
    sink = null
    runIdMemo = null
    return
  }

  const fileDir = c?.fileDir
    ? (path.isAbsolute(c.fileDir) ? c.fileDir : path.join(repoRoot, c.fileDir))
    : path.join(repoRoot, 'dist/analytics')

  const salt = c?.salt
  cfg = { enabled, sink: 'file', fileDir, salt }
  sink = new FileSink(fileDir)
  repoRootMemo = repoRoot
  saltMemo = salt
  if (runId) {
    runAnalyticsFile(runId)
  }
}

export function runAnalyticsFile(runId: string) {
  if (!cfg?.enabled || !sink) return
  runIdMemo = runId
  sink.setRunFile(runId)
}

function enabled() { return !!cfg?.enabled && !!sink }

export async function trackRunStarted(payload: {
  run_id: string
  provider?: string
  profile?: string
  pr_id?: string
  commit_sha?: string
  repo?: string
}) {
  if (!enabled()) return
  if (payload.run_id && payload.run_id !== runIdMemo) runAnalyticsFile(payload.run_id)

  await sink!.write({
    type: 'run.started',
    ts: Date.now(),
    ...payload,
  } as AnalyticsEvent)
}

export async function trackFinding(payload: {
  run_id: string
  rule_id: string
  severity: Severity
  file?: string
  locator?: string
}) {
  if (!enabled()) return
  if (payload.run_id && payload.run_id !== runIdMemo) runAnalyticsFile(payload.run_id)

  const file_hash = payload.file ? hashPath(payload.file, repoRootMemo, saltMemo) : undefined
  await sink!.write({
    type: 'finding.reported',
    ts: Date.now(),
    run_id: payload.run_id,
    rule_id: payload.rule_id,
    severity: payload.severity,
    file_hash,
    locator: payload.locator,
  } as AnalyticsEvent)
}

export async function trackRunFinished(payload: {
  run_id: string
  duration_ms: number
  findings_total: number
  findings_by_severity: Partial<Record<Severity, number>>
  cost_tokens?: number
  cost_usd?: number
  ok: boolean
  impact_score?: number
}) {
  if (!enabled()) return
  if (payload.run_id && payload.run_id !== runIdMemo) runAnalyticsFile(payload.run_id)

  await sink!.write({
    type: 'run.finished',
    ts: Date.now(),
    ...payload,
  } as AnalyticsEvent)
}

export async function trackFeedback(payload: {
  run_id: string
  rule_id: string
  action: 'accept' | 'dismiss' | 'mute_rule' | 'escalate'
}) {
  if (!enabled()) return
  if (payload.run_id && payload.run_id !== runIdMemo) runAnalyticsFile(payload.run_id)

  await sink!.write({
    type: 'feedback.given',
    ts: Date.now(),
    ...payload,
  } as AnalyticsEvent)
}
