import path from 'node:path'
import crypto from 'node:crypto'
import fs from 'node:fs'

import type { ReviewJson, Severity, RulesJson } from '@sentinel/core'
import {
  findRepoRoot,
  maxSeverity,
  sevRank,
  printAnalyticsSummary,
  printReviewSummary,
  fail,
} from '../cli-utils'
import { pickProvider } from './providers'
import { loadRules, loadBoundaries } from './profiles'
import { writeArtifacts, makeLatestPaths, makeHistoryPaths } from './io'
import { resolveAnalyticsConfig, createAnalyticsClient } from '@sentinel/analytics'
import { buildContextCLI } from '../context'
import { loadConfig, type ProviderName } from '../config'

const REPO_ROOT = findRepoRoot()

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

async function ensureContext(profile: string, rc: ReturnType<typeof loadConfig>) {
  const outFile = path.join(rc.out.contextDirAbs, `${profile}.md`)
  if (!fs.existsSync(outFile)) {
    await buildContextCLI({
      profile,
      profilesDir: rc.profilesDir,
      out: outFile,
      includeADR: rc.context.includeADR,
      includeBoundaries: rc.context.includeBoundaries,
      maxBytes: rc.context.maxBytes,
      maxApproxTokens: rc.context.maxApproxTokens,
    } as any)
  }
  let md = fs.readFileSync(outFile, 'utf8')
  const limit = rc.context.maxBytes || 1_500_000
  if (Buffer.byteLength(md, 'utf8') > limit) {
    md = Buffer.from(md, 'utf8').subarray(0, limit).toString('utf8')
  }
  return md
}

export async function runReviewCLI(opts: {
  diff: string
  profile: string
  outMd: string
  outJson?: string
  profilesDir?: string
  provider?: ProviderName
  failOn?: 'none' | 'major' | 'critical'
  maxComments?: number
  analytics?: boolean
  analyticsOut?: string
  debug?: boolean
  rc?: any
}) {
  // ── resolve rc (CLI config)
  const rc = opts.rc ?? loadConfig({
    profile: opts.profile,
    provider: opts.provider,
    profilesDir: opts.profilesDir,
    failOn: opts.failOn as any,
    maxComments: opts.maxComments,
  })

  // ── provider
  const provider = await pickProvider(rc.provider)
  const providerLabel = provider.name || rc.provider || 'local'

  // ── diff
  const diffPath = path.isAbsolute(opts.diff) ? opts.diff : path.join(REPO_ROOT, opts.diff)
  if (!fs.existsSync(diffPath)) {
    fail(`[review] diff file not found at ${diffPath}`)
    process.exit(2)
  }
  const diffText = fs.readFileSync(diffPath, 'utf8')

  // ── rules/boundaries/context
  const rulesRaw: RulesJson | null = loadRules(REPO_ROOT, rc.profile, rc.profilesDir)
  const boundaries = loadBoundaries(REPO_ROOT, rc.profile, rc.profilesDir)
  const contextMd = await ensureContext(rc.profile, rc)

  const runId = crypto.randomUUID?.() ?? `run_${Date.now()}`
  const startedAt = Date.now()

  // ── analytics
  const cfgResolved = resolveAnalyticsConfig({
    rc,
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
      profile: rc.profile,
      env: (process.env.SENTINEL_ENV as any) || 'dev',
    },
    cfgResolved
  )

  // ── outputs (latest & history)
  const latest = makeLatestPaths(rc.out.reviewsDirAbs, rc.profile, rc.out.mdName, rc.out.jsonName)
  const history = makeHistoryPaths(rc.out.reviewsDirAbs, rc.profile, runId, rc.out.mdName, rc.out.jsonName)

  // ── provider debug dir
  const debugDir = path.join(rc.out.reviewsDirAbs, rc.profile, 'debug')
  if (opts.debug) fs.mkdirSync(debugDir, { recursive: true })

  try {
    await analytics.init()
    analytics.start(runId, { model: rc.providerOptions?.model })
    printAnalyticsSummary({ repoRoot: REPO_ROOT, runId, diag: analytics.diagnostics() })

    // ── main provider call (no env leakage)
    const review: ReviewJson = await provider.review({
      repoRoot: REPO_ROOT,
      profile: rc.profile,
      diffText,
      rules: rulesRaw,
      boundaries,
      context: { markdown: contextMd, maxBytes: rc.context.maxBytes },
      providerOptions: rc.providerOptions,
      debug: { enabled: !!opts.debug, debug: !!opts.debug, dir: debugDir },
    })

    // normalize run id
    review.ai_review.run_id = runId

    // ── cap findings (CLI flag > ENV)
    const cap =
      Number.isFinite(opts.maxComments as number)
        ? (opts.maxComments as number)
        : (process.env.SENTINEL_MAX_COMMENTS ? Number(process.env.SENTINEL_MAX_COMMENTS) : undefined)

    if (cap && cap > 0 && review.ai_review.findings.length > cap) {
      review.ai_review.findings = review.ai_review.findings.slice(0, cap)
    }

    // ── write artifacts (latest + history)
    writeArtifacts(latest.json, latest.md, review)
    writeArtifacts(history.json, history.md, review)

    // ── summary + exit
    const findings = review.ai_review.findings as { severity: Severity; rule: string; file?: string; locator?: string }[]
    const top = maxSeverity(findings)
    const exit = computeExit(top, opts.failOn)

    printReviewSummary({
      repoRoot: REPO_ROOT,
      providerLabel,
      profile: rc.profile,
      outJsonPath: latest.json,
      outMdPath: latest.md,
      findings,
      exit,
    })

    // ── analytics brief
    const counts = { critical: 0, major: 0, minor: 0, info: 0 as number }
    for (const f of findings) (counts as any)[f.severity]++

    await analytics.finish({
      duration_ms: Date.now() - startedAt,
      findings_total: findings.length,
      findings_by_severity: counts as any,
    })

    process.exit(exit.exitCode)
  } catch (e: any) {
    try {
      await analytics.finish({
        duration_ms: Date.now() - startedAt,
        findings_total: 0,
        findings_by_severity: { critical: 0, major: 0, minor: 0, info: 0 },
      })
    } catch {}
    fail(String(e?.stack || e))
    process.exit(2)
  }
}
