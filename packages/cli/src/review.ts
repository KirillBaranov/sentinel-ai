// packages/cli/src/review.ts
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ReviewJson, BoundariesConfig, Severity, RulesJson, RuleItem } from '@sentinel/core'

import type { ReviewProvider } from '@sentinel/provider-types'
import { mockProvider } from '@sentinel/provider-mock'
import { localProvider } from '@sentinel/provider-local'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../../../')

// ────────────────────────────────────────────────────────────────────────────────
// helpers
// ────────────────────────────────────────────────────────────────────────────────
function ensureDirForFile(p: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true })
}

function resolveProfileRoot(repoRoot: string, profile: string, profilesDir?: string): string {
  // путь указан явно
  if (profile.includes('/') || profile.startsWith('.') || path.isAbsolute(profile)) {
    const abs = path.isAbsolute(profile) ? profile : path.join(repoRoot, profile)
    if (!fs.existsSync(abs)) throw new Error(`[profile] path not found: ${abs}`)
    return abs
  }

  // общий каталог профилей
  if (profilesDir) {
    const base = path.isAbsolute(profilesDir) ? profilesDir : path.join(repoRoot, profilesDir)
    const candidate = path.join(base, profile)
    if (fs.existsSync(candidate)) return candidate
  }

  // стандартные места
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

function pickProvider(id?: string): ReviewProvider {
  const name = (id || process.env.SENTINEL_PROVIDER || 'local').toLowerCase()
  if (name === 'mock') return mockProvider
  // дефолт — локальный провайдер (детерминированный)
  return localProvider
}

// severity helpers
const sevRank: Record<Severity, number> = { critical: 3, major: 2, minor: 1, info: 0 }
function maxSeverity(findings: { severity: Severity }[]): Severity | null {
  let max: Severity | null = null
  for (const f of findings) {
    if (!max || sevRank[f.severity] > sevRank[max]) max = f.severity
  }
  return max
}

// ────────────────────────────────────────────────────────────────────────────────
// CLI entry
// ────────────────────────────────────────────────────────────────────────────────
export async function runReviewCLI(opts: {
  diff: string
  profile: string
  outMd: string        // transport markdown with JSON block
  outJson?: string     // canonical json (dist/review.json by default)
  profilesDir?: string
  provider?: string    // 'mock' | 'local' | future adapters
  failOn?: 'major' | 'critical'
  maxComments?: number
}) {
  const provider = pickProvider(opts.provider)

  const OUT_DIR = path.join(REPO_ROOT, 'dist')
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const toDist = (p: string | undefined, fallbackName: string) =>
    p && path.isAbsolute(p) ? p : path.join(OUT_DIR, path.basename(p || fallbackName))

  const outMdPath = toDist(opts.outMd, 'review.md')
  const outJsonPath = toDist(opts.outJson || 'review.json', 'review.json')

  const diffPath = path.resolve(opts.diff)
  const diffText = fs.readFileSync(diffPath, 'utf8')

  const rulesRaw = loadRules(opts.profile, opts.profilesDir)
  const boundaries = loadBoundaries(opts.profile, opts.profilesDir)

  // единый путь: всегда через провайдера
  const review: ReviewJson = await provider.review({
    diffText,
    profile: opts.profile,
    rules: rulesRaw,
    boundaries
  })

  // cap findings if requested
  const envCapRaw = process.env.SENTINEL_MAX_COMMENTS
  const envCap = envCapRaw != null ? Number(envCapRaw) : undefined
  const cap = Number.isFinite(opts.maxComments as number) ? opts.maxComments
            : Number.isFinite(envCap as number) ? envCap
            : undefined
  if (cap && cap > 0 && review.ai_review.findings.length > cap) {
    review.ai_review.findings = review.ai_review.findings.slice(0, cap)
  }

  // canonical JSON
  ensureDirForFile(outJsonPath)
  fs.writeFileSync(outJsonPath, JSON.stringify(review, null, 2))

  // transport markdown (json fenced)
  const mdPayload =
    `<!-- SENTINEL:DUAL:JSON -->\n` +
    '```json\n' +
    JSON.stringify(review, null, 2) +
    '\n```\n' +
    `<!-- SENTINEL:DUAL:JSON:END -->\n`

  ensureDirForFile(outMdPath)
  fs.writeFileSync(outMdPath, mdPayload)

  const providerLabel = (provider as ReviewProvider).name || 'local'
  const count = review.ai_review.findings.length
  console.log(`[review:${providerLabel}] wrote ${path.relative(REPO_ROOT, outJsonPath)} & ${path.relative(REPO_ROOT, outMdPath)} (${count} findings)`)

  // exit policy
  const top = maxSeverity(review.ai_review.findings as any as { severity: Severity }[]) // type align
  if (opts.failOn) {
    const threshold: Severity = opts.failOn === 'critical' ? 'critical' : 'major'
    const shouldFail = top != null && sevRank[top] >= sevRank[threshold]
    process.exit(shouldFail ? 1 : 0)
  } else {
    const code =
      top === 'critical' ? 20 :
      top === 'major'    ? 10 :
                           0
    process.exit(code)
  }
}
