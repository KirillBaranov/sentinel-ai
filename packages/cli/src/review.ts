import fs from 'node:fs'
import path from 'node:path'

import type {
  ReviewJson,
  RulesJson,
  BoundariesConfig,
  Severity,
} from '@sentinel/core'

import type { ReviewProvider } from '@sentinel/provider-types'
import { mockProvider } from '@sentinel/provider-mock'
import { localProvider } from '@sentinel/provider-local'

import {
  ensureDirForFile,
  printReviewSummary,
  maxSeverity,
  sevRank,
  findRepoRoot,
} from './cli-utils'

// ────────────────────────────────────────────────────────────────────────────────
// Repo root
// ────────────────────────────────────────────────────────────────────────────────
const REPO_ROOT = findRepoRoot()

// ────────────────────────────────────────────────────────────────────────────────
// profile/rules loaders
// ────────────────────────────────────────────────────────────────────────────────
function resolveProfileRoot(repoRoot: string, profile: string, profilesDir?: string): string {
  if (profile.includes('/') || profile.startsWith('.') || path.isAbsolute(profile)) {
    const abs = path.isAbsolute(profile) ? profile : path.join(repoRoot, profile)
    if (!fs.existsSync(abs)) throw new Error(`[profile] path not found: ${abs}`)
    return abs
  }
  if (profilesDir) {
    const base = path.isAbsolute(profilesDir) ? profilesDir : path.join(repoRoot, profilesDir)
    const candidate = path.join(base, profile)
    if (fs.existsSync(candidate)) return candidate
  }
  const candidates = [
    path.join(repoRoot, 'profiles', profile),
    path.join(repoRoot, 'packages', 'profiles', profile),
  ]
  for (const c of candidates) if (fs.existsSync(c)) return c
  throw new Error(`[profile] not found: "${profile}" (tried: ${candidates.join(', ')})`)
}

function loadRules(profile: string, profilesDir?: string): RulesJson | null {
  const PROFILE_ROOT = resolveProfileRoot(REPO_ROOT, profile, profilesDir)
  const rulesPath = path.join(PROFILE_ROOT, 'docs', 'rules', 'rules.json')
  try {
    return JSON.parse(fs.readFileSync(rulesPath, 'utf8')) as RulesJson
  } catch {
    console.warn(`[review] rules.json not found or invalid for profile=${profile}. Looked at: ${rulesPath}`)
    return null
  }
}

function loadBoundaries(profile: string, profilesDir?: string): BoundariesConfig | null {
  const PROFILE_ROOT = resolveProfileRoot(REPO_ROOT, profile, profilesDir)
  const p = path.join(PROFILE_ROOT, 'docs', 'rules', 'boundaries.json')
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as BoundariesConfig
  } catch {
    console.warn(`[review] boundaries.json not found for profile=${profile} (expected at ${p})`)
    return null
  }
}

// ────────────────────────────────────────────────────────────────────────────────
// provider
// ────────────────────────────────────────────────────────────────────────────────
function pickProvider(id?: string): ReviewProvider {
  const name = (id || process.env.SENTINEL_PROVIDER || 'local').toLowerCase()
  if (name === 'mock') return mockProvider
  return localProvider
}

// ────────────────────────────────────────────────────────────────────────────────
// CLI entry
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
  debug?: boolean
}) {
  const provider = pickProvider(opts.provider)

  const OUT_DIR = path.join(REPO_ROOT, 'dist')
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const toDist = (p: string | undefined, fallbackName: string) =>
    p && path.isAbsolute(p) ? p : path.join(OUT_DIR, path.basename(p || fallbackName))

  const outMdPath = toDist(opts.outMd, 'review.md')
  const outJsonPath = toDist(opts.outJson || 'review.json', 'review.json')

  // diff: всегда резолвим относительно корня репо
  const diffPath = path.isAbsolute(opts.diff) ? opts.diff : path.join(REPO_ROOT, opts.diff)
  if (!fs.existsSync(diffPath)) {
    throw new Error(`[review] diff file not found at ${diffPath} (passed: ${opts.diff})`)
  }
  const diffText = fs.readFileSync(diffPath, 'utf8')

  const rulesRaw = loadRules(opts.profile, opts.profilesDir)
  const boundaries = loadBoundaries(opts.profile, opts.profilesDir)

  if (opts.debug) {
    console.log('[review:debug]', {
      REPO_ROOT,
      provider: provider.name || 'local',
      diffPath,
      outMdPath,
      outJsonPath,
      profilesDir: opts.profilesDir,
      profile: opts.profile,
      hasRules: !!rulesRaw,
      hasBoundaries: !!boundaries,
    })
  }

  // Всегда через адаптер
  const review: ReviewJson = await provider.review({
    diffText,
    profile: opts.profile,
    rules: rulesRaw,
    boundaries,
  })

  // cap findings if requested
  const envCapRaw = process.env.SENTINEL_MAX_COMMENTS
  const envCap = envCapRaw != null ? Number(envCapRaw) : undefined
  const cap =
    Number.isFinite(opts.maxComments as number) ? opts.maxComments
    : Number.isFinite(envCap as number) ? envCap
    : undefined
  if (cap && cap > 0 && review.ai_review.findings.length > cap) {
    review.ai_review.findings = review.ai_review.findings.slice(0, cap)
  }

  // write artifacts
  ensureDirForFile(outJsonPath)
  fs.writeFileSync(outJsonPath, JSON.stringify(review, null, 2), 'utf8')

  const mdPayload =
    `<!-- SENTINEL:DUAL:JSON -->\n` +
    '```json\n' +
    JSON.stringify(review, null, 2) +
    '\n```\n' +
    `<!-- SENTINEL:DUAL:JSON:END -->\n`

  ensureDirForFile(outMdPath)
  fs.writeFileSync(outMdPath, mdPayload, 'utf8')

  // summary + exit
  const findings = review.ai_review.findings as unknown as { severity: Severity }[]
  const top = maxSeverity(findings)

  let exit: { mode: 'legacy' | 'threshold' | 'none'; exitCode: number; threshold?: Severity; top?: Severity | null }
  if (opts.failOn === 'none') {
    exit = { mode: 'none', exitCode: 0 }
  } else if (opts.failOn) {
    const threshold: Severity = opts.failOn === 'critical' ? 'critical' : 'major'
    const shouldFail = top != null && sevRank[top] >= sevRank[threshold]
    exit = { mode: 'threshold', exitCode: shouldFail ? 1 : 0, threshold, top }
  } else {
    const code = top === 'critical' ? 20 : top === 'major' ? 10 : 0
    exit = { mode: 'legacy', exitCode: code, top }
  }

  printReviewSummary({
    repoRoot: REPO_ROOT,
    providerLabel: provider.name || 'local',
    profile: opts.profile,
    outJsonPath,
    outMdPath,
    findings,
    exit,
  })

  process.exit(exit.exitCode)
}
