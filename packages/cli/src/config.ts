import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../../../')

export type FailOn = 'major' | 'critical'
export type ProviderName = 'local' | 'mock' | 'openai' | 'claude'

export interface SentinelRc {
  defaultProfile?: string
  profilesDir?: string                    // e.g. "packages/profiles"
  provider?: ProviderName                 // default provider
  failOn?: FailOn                         // CI exit policy
  maxComments?: number                    // cap findings
  output?: {
    dir?: string                          // e.g. "dist"
    mdName?: string                       // e.g. "review.md"
    jsonName?: string                     // e.g. "review.json"
  }
  render?: {
    template?: string                     // path to md template
    severityMap?: Record<string, string>  // "critical" -> "blocker" etc.
  }
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

/** try to find .sentinelrc.json walking up from cwd to repo root */
function findRc(startDir: string): string | null {
  let dir = startDir
  while (true) {
    const p = path.join(dir, '.sentinelrc.json')
    if (fs.existsSync(p)) return p
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  // also check repo root as fallback
  const fallback = path.join(REPO_ROOT, '.sentinelrc.json')
  return fs.existsSync(fallback) ? fallback : null
}

function loadRc(): SentinelRc {
  const p = findRc(process.cwd())
  if (!p) return {}
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as SentinelRc
  } catch {
    console.warn(`[config] invalid .sentinelrc.json at ${p}, ignored`)
    return {}
  }
}

/** ENV → partial rc */
function envAsRc(): Partial<SentinelRc> {
  const out: Partial<SentinelRc> = {}

  if (process.env.SENTINEL_PROFILE) out.defaultProfile = process.env.SENTINEL_PROFILE
  if (process.env.SENTINEL_PROFILES_DIR) out.profilesDir = process.env.SENTINEL_PROFILES_DIR as string
  if (process.env.SENTINEL_PROVIDER) out.provider = process.env.SENTINEL_PROVIDER as ProviderName
  if (process.env.SENTINEL_FAIL_ON) out.failOn = process.env.SENTINEL_FAIL_ON as FailOn
  if (process.env.SENTINEL_MAX_COMMENTS) out.maxComments = Number(process.env.SENTINEL_MAX_COMMENTS)

  const outDir = process.env.SENTINEL_OUT_DIR
  const outMd = process.env.SENTINEL_OUT_MD
  const outJson = process.env.SENTINEL_OUT_JSON
  if (outDir || outMd || outJson) {
    out.output = merge(out.output || {}, {
      dir: outDir,
      mdName: outMd,
      jsonName: outJson
    })
  }

  const includeADR = process.env.SENTINEL_CONTEXT_INCLUDE_ADR
  const includeBoundaries = process.env.SENTINEL_CONTEXT_INCLUDE_BOUNDARIES
  const maxBytes = process.env.SENTINEL_CONTEXT_MAX_BYTES
  const maxTokens = process.env.SENTINEL_CONTEXT_MAX_TOKENS
  if (includeADR || includeBoundaries || maxBytes || maxTokens) {
    out.context = merge(out.context || {}, {
      includeADR: includeADR ? includeADR === '1' : undefined,
      includeBoundaries: includeBoundaries ? includeBoundaries === '1' : undefined,
      maxBytes: maxBytes ? Number(maxBytes) : undefined,
      maxApproxTokens: maxTokens ? Number(maxTokens) : undefined
    })
  }

  return out
}

const defaults: Required<Pick<SentinelRc,
  'defaultProfile' | 'provider' | 'output' | 'context'
>> = {
  defaultProfile: 'frontend',
  provider: 'local',
  output: { dir: 'dist', mdName: 'review.md', jsonName: 'review.json' },
  context: { includeADR: true, includeBoundaries: true, maxBytes: 1_500_000, maxApproxTokens: 0 }
}

/** Load and merge: defaults <- rc <- env <- cli(partial) */
export function loadConfig(cliOverrides?: Partial<SentinelRc>) {
  const rc = loadRc()
  const envRc = envAsRc()
  const merged = merge(merge(merge(defaults, rc), envRc), cliOverrides)

  // normalize output dir to absolute under repo if relative
  const out = merged.output || {}
  const outDir = out.dir
  if (outDir && !path.isAbsolute(outDir)) {
    merged.output = { ...out, dir: path.join(REPO_ROOT, outDir) }
  }
  return merged
}

export const _internal = { REPO_ROOT }
