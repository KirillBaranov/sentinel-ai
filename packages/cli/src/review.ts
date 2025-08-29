import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ReviewJson, RulesJson, RuleItem, BoundariesConfig } from '@sentinel/core'
import { analyzeDiff } from '@sentinel/core'

import type { ReviewProvider } from '@sentinel/provider-types'
import { mockProvider } from '@sentinel/provider-mock'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../../../')

function ensureDirForFile(p: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true })
}

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

// ────────────────────────────────────────────────────────────────────────────────
// Rules/boundaries loaders
// ────────────────────────────────────────────────────────────────────────────────
function loadRules(profile: string, profilesDir?: string): { byId: Map<string, RuleItem>, raw: RulesJson | null } {
  const PROFILE_ROOT = resolveProfileRoot(REPO_ROOT, profile, profilesDir)
  const rulesPath = path.join(PROFILE_ROOT, 'docs', 'rules', 'rules.json')
  try {
    const raw = JSON.parse(fs.readFileSync(rulesPath, 'utf8')) as RulesJson
    const byId = new Map<string, RuleItem>()
    for (const r of raw.rules) byId.set(r.id, r)
    return { byId, raw }
  } catch {
    console.warn(`[review] rules.json not found or invalid for profile=${profile}. Looked at: ${rulesPath}`)
    return { byId: new Map(), raw: null }
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
// Provider picker (без fallback, единая схема dev/prod)
// ────────────────────────────────────────────────────────────────────────────────
function pickProvider(name?: string): ReviewProvider | 'local' {
  const id = (name || process.env.SENTINEL_PROVIDER || 'local').toLowerCase()
  if (id === 'mock') return mockProvider
  return 'local'
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
  provider?: string    // 'mock' | 'local'
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

  const { byId: rulesById, raw: rulesRaw } = loadRules(opts.profile, opts.profilesDir)
  const boundaries = loadBoundaries(opts.profile, opts.profilesDir)

  let review: ReviewJson

  if (provider === 'local') {
    const findings = analyzeDiff({
      diffText,
      rulesById,
      rulesJson: rulesRaw,
      boundaries
    })
    review = { ai_review: { version: 1, run_id: `run_${Date.now()}`, findings } }
  } else {
    review = await provider.review({
      diffText,
      profile: opts.profile,
      rules: rulesRaw,
      boundaries
    })
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

  console.log(
    `[review:${provider === 'local' ? 'local' : (provider as ReviewProvider).name}]` +
    ` wrote ${path.relative(REPO_ROOT, outJsonPath)} & ${path.relative(REPO_ROOT, outMdPath)}` +
    ` (${review.ai_review.findings.length} findings)`
  )
}
