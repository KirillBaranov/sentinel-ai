
import fs from 'node:fs'
import path from 'node:path'
import { findRepoRoot } from './cli-utils'

export type FailOn = 'major' | 'critical'
export type ProviderName = 'local' | 'mock' | 'openai' | 'claude'

export interface SentinelRc {
  /** defaults */
  defaultProfile?: string
  provider?: ProviderName

  /** profiles root, e.g. "packages/profiles" */
  profilesDir?: string

  /** CI exit policy and limits */
  failOn?: FailOn
  maxComments?: number

  /** output artefacts */
  output?: {
    dir?: string            // e.g. "dist"
    mdName?: string         // e.g. "review.md"
    jsonName?: string       // e.g. "review.json"
  }

  /** rendering options */
  render?: {
    template?: string
    severityMap?: Record<string, string>
  }

  /** build-context options */
  context?: {
    includeADR?: boolean
    includeBoundaries?: boolean
    maxBytes?: number
    maxApproxTokens?: number
  }
}

/** shallow merge (src overrides dst) */
function merge<A extends object, B extends object>(dst: A, src?: B): A & B {
  return Object.assign({}, dst, src || {}) as any
}

const REPO_ROOT = findRepoRoot()

/** Walk up from start to FS root (not past repo root) and find nearest .sentinelrc.json */
function findRc(startDir: string, repoRoot = REPO_ROOT): string | null {
  let dir = path.resolve(startDir)

  while (true) {
    const candidate = path.join(dir, '.sentinelrc.json')
    if (fs.existsSync(candidate)) return candidate

    const parent = path.dirname(dir)
    if (parent === dir) break
    if (dir === repoRoot) break
    dir = parent
  }

  const fallback = path.join(repoRoot, '.sentinelrc.json')
  return fs.existsSync(fallback) ? fallback : null
}

function readJsonSafe(p: string): any | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null }
}

function loadRcFromDisk(): SentinelRc {
  const p = findRc(process.cwd(), REPO_ROOT)
  if (!p) return {}
  const data = readJsonSafe(p)
  if (!data || typeof data !== 'object') {
    console.warn(`[config] invalid .sentinelrc.json at ${p}, ignored`)
    return {}
  }
  return data as SentinelRc
}

function envAsRc(): Partial<SentinelRc> {
  const out: Partial<SentinelRc> = {}

  if (process.env.SENTINEL_PROFILE) out.defaultProfile = process.env.SENTINEL_PROFILE
  if (process.env.SENTINEL_PROFILES_DIR) out.profilesDir = process.env.SENTINEL_PROFILES_DIR
  if (process.env.SENTINEL_PROVIDER) out.provider = process.env.SENTINEL_PROVIDER as ProviderName
  if (process.env.SENTINEL_FAIL_ON) out.failOn = process.env.SENTINEL_FAIL_ON as FailOn
  if (process.env.SENTINEL_MAX_COMMENTS) out.maxComments = Number(process.env.SENTINEL_MAX_COMMENTS)

  const outDir  = process.env.SENTINEL_OUT_DIR
  const outMd   = process.env.SENTINEL_OUT_MD
  const outJson = process.env.SENTINEL_OUT_JSON
  if (outDir || outMd || outJson) {
    out.output = merge(out.output || {}, {
      dir: outDir,
      mdName: outMd,
      jsonName: outJson,
    })
  }

  const includeADR        = process.env.SENTINEL_CONTEXT_INCLUDE_ADR
  const includeBoundaries = process.env.SENTINEL_CONTEXT_INCLUDE_BOUNDARIES
  const maxBytes          = process.env.SENTINEL_CONTEXT_MAX_BYTES
  const maxTokens         = process.env.SENTINEL_CONTEXT_MAX_TOKENS
  if (includeADR || includeBoundaries || maxBytes || maxTokens) {
    out.context = merge(out.context || {}, {
      includeADR:        includeADR ? includeADR === '1' : undefined,
      includeBoundaries: includeBoundaries ? includeBoundaries === '1' : undefined,
      maxBytes:          maxBytes ? Number(maxBytes) : undefined,
      maxApproxTokens:   maxTokens ? Number(maxTokens) : undefined,
    })
  }

  return out
}

const defaults: Required<Pick<SentinelRc, 'defaultProfile' | 'provider' | 'output' | 'context'>> = {
  defaultProfile: 'frontend',
  provider: 'local',
  output: { dir: 'dist', mdName: 'review.md', jsonName: 'review.json' },
  context: { includeADR: true, includeBoundaries: true, maxBytes: 1_500_000, maxApproxTokens: 0 },
}

/** Load and merge: defaults <- rc(file) <- env <- cli(partial) */
export function loadConfig(cliOverrides?: Partial<SentinelRc>) {
  const rc = loadRcFromDisk()
  const envRc = envAsRc()
  const merged = merge(merge(merge(defaults, rc), envRc), cliOverrides)

  const out = merged.output || {}
  const outDir = out.dir
  if (outDir && !path.isAbsolute(outDir)) {
    merged.output = { ...out, dir: path.join(REPO_ROOT, outDir) }
  }

  if (merged.profilesDir && !path.isAbsolute(merged.profilesDir)) {
    merged.profilesDir = path.join(REPO_ROOT, merged.profilesDir)
  }

  return merged
}

export const _internal = { REPO_ROOT }
