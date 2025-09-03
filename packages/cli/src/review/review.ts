import * as path from 'node:path'
import * as crypto from 'node:crypto'

import type { ReviewJson, Severity } from '@sentinel/core'
import { maxSeverity, sevRank, findRepoRoot, printReviewSummary, printAnalyticsSummary } from '../cli-utils'

import { pickProvider } from './providers'
import { loadRules, loadBoundaries } from './profiles'
import { readDiff, prepareOutputs, writeArtifacts } from './io'

import { resolveAnalyticsConfig, createAnalyticsClient } from "@sentinel/analytics"

// ────────────────────────────────────────────────────────────────────────────────
const REPO_ROOT = findRepoRoot()

function capFindings<T extends { severity: Severity }>(list: T[], cap?: number): T[] {
  return cap && cap > 0 && list.length > cap ? list.slice(0, cap) : list
}

type Exit =
  | { mode: 'legacy'; exitCode: number; top?: Severity | null }
  | { mode: 'threshold'; exitCode: number; threshold: Severity; top?: Severity | null }
  | { mode: 'none'; exitCode: 0 }

function computeExit(top: Severity | null | undefined, failOn?: 'none' | 'major' | 'critical'): Exit {
  if (failOn === 'none') return { mode: 'none', exitCode: 0 }
  if (failOn) {
    const threshold: Severity = failOn === 'critical' ? 'critical' : 'major'
    const shouldFail = top != null && sevRank[top] >= sevRank[threshold]
    return { mode: 'threshold', exitCode: shouldFail ? 1 : 0, threshold, top }
  }
  const code = top === 'critical' ? 20 : top === 'major' ? 10 : 0
  return { mode: 'legacy', exitCode: code, top }
}

// helpers
const sha1 = (s: string) => crypto.createHash('sha1').update(s).digest('hex')
const salted = (s: string, salt: string) => sha1(`${salt}:${s}`)
function resolveAbs(repoRoot: string, maybePath?: string): string | undefined {
  if (!maybePath) return undefined
  return path.isAbsolute(maybePath) ? maybePath : path.join(repoRoot, maybePath)
}

// ────────────────────────────────────────────────────────────────────────────────
export async function runReviewCLI(opts: {
  diff: string
  profile: string
  outMd: string
  outJson?: string
  profilesDir?: string
  provider?: string
  failOn?: 'none' | 'major' | 'critical'
  maxComments?: number
  analytics?: boolean
  analyticsOut?: string
  debug?: boolean
  rc?: any               // пробрасываем целиком rc из команды
}) {
  const provider = pickProvider(opts.provider)
  const providerLabel = provider.name || 'local'

  const { outMdPath, outJsonPath } = prepareOutputs(REPO_ROOT, opts.outMd, opts.outJson)
  const { diffPath, diffText } = readDiff(REPO_ROOT, opts.diff)

  const rulesRaw = loadRules(REPO_ROOT, opts.profile, opts.profilesDir)
  const boundaries = loadBoundaries(REPO_ROOT, opts.profile, opts.profilesDir)

  if (opts.debug) {
    console.log('[review:debug]', {
      REPO_ROOT,
      provider: providerLabel,
      diffPath,
      outMdPath,
      outJsonPath,
      profilesDir: opts.profilesDir,
      profile: opts.profile,
      hasRules: !!rulesRaw,
      hasBoundaries: !!boundaries,
    })
  }

  // ── Analytics: resolver + client
  const runId = crypto.randomUUID?.() ?? `run_${Date.now()}`
  const cfgResolved = resolveAnalyticsConfig({
    rc: opts.rc,                       // .sentinelrc.json уже разобран в командe
    repoRoot: REPO_ROOT,
    overrides: {
      enabled: typeof opts.analytics === 'boolean' ? opts.analytics : undefined,
      outDir: opts.analyticsOut,
    },
  })

  const analytics = createAnalyticsClient(
    {
      projectRemoteUrl: process.env.GIT_REMOTE_URL || process.env.CI_REPOSITORY_URL,
      commitSha: process.env.GIT_COMMIT_SHA || process.env.CI_COMMIT_SHA,
      branch: process.env.GIT_BRANCH || process.env.CI_COMMIT_BRANCH,
      provider: providerLabel,
      profile: opts.profile,
      env: (process.env.SENTINEL_ENV as any) || 'dev',
    },
    cfgResolved
  )

  await analytics.init()
  analytics.start(runId, { model: process.env.SENTINEL_MODEL })

  printAnalyticsSummary({ repoRoot: REPO_ROOT, runId, diag: analytics.diagnostics() })

  const startedAt = Date.now()

  // ── Основной review через провайдера
  const review: ReviewJson = await provider.review({
    diffText,
    profile: opts.profile,
    rules: rulesRaw,
    boundaries,
  })

  // Канонизируем run_id
  review.ai_review.run_id = runId

  // cap findings: cli flag > ENV
  const envCap = process.env.SENTINEL_MAX_COMMENTS ? Number(process.env.SENTINEL_MAX_COMMENTS) : undefined
  const cap = Number.isFinite(opts.maxComments as number)
    ? (opts.maxComments as number)
    : Number.isFinite(envCap as number)
    ? (envCap as number)
    : undefined

  review.ai_review.findings = capFindings(
    review.ai_review.findings as unknown as { severity: Severity }[],
    cap
  ) as any

  // артефакты JSON + Markdown транспорт
  writeArtifacts(outJsonPath, outMdPath, review)

  // summary + exit
  const findings = review.ai_review.findings as unknown as {
    severity: Severity
    rule: string
    file?: string
    locator?: string
  }[]

  const top = maxSeverity(findings)
  const exit = computeExit(top, opts.failOn)

  printReviewSummary({
    repoRoot: REPO_ROOT,
    providerLabel,
    profile: opts.profile,
    outJsonPath,
    outMdPath,
    findings,
    exit,
  })

  // ── Analytics: finding.reported + run.finished
  const counts: Record<Severity, number> = { critical: 0, major: 0, minor: 0, info: 0 }
  const salt = cfgResolved.salt // используем ровно тот же salt, что и рантайм

  for (const f of findings) {
    counts[f.severity] = (counts[f.severity] ?? 0) + 1

    // privacy-first: хеш абсолютного пути
    const fileAbs = resolveAbs(REPO_ROOT, f.file)
    const fileHash = fileAbs ? salted(fileAbs, salt) : 'unknown'

    analytics.finding({
      rule_id: f.rule,
      severity: f.severity,
      file_hash: fileHash,
      locator: f.locator || 'L0',
      signals: {
        provider_conf: (f as any).providerConfidence,
        rule_conf: (f as any).ruleConfidence,
      },
    })
  }

  analytics.finish({
    duration_ms: Date.now() - startedAt,
    findings_total: findings.length,
    findings_by_severity: counts,
  })

  process.exit(exit.exitCode)
}
