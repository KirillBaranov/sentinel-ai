// packages/cli/src/config.ts
import fs from 'node:fs'
import path from 'node:path'
import { findRepoRoot } from '../cli-utils'

export type FailOn = 'major' | 'critical'
export type ProviderName = 'local' | 'mock' | 'openai' | 'claude'

export interface SentinelRc {
  profile?: string
  provider?: ProviderName
  /** profiles root, e.g. "packages/profiles" */
  profilesDir?: string

  /** CI exit policy and limits */
  failOn?: FailOn
  maxComments?: number

  /** Единый стандарт путей */
  out?: {
    root?: string          // корень артефактов, по умолчанию ".sentinel"
    contextDir?: string    // "context"
    reviewsDir?: string    // "reviews"
    analyticsDir?: string  // "analytics"
    exportsDir?: string    // "exports"
    // для review-файлов храним только имена (куда класть — решает reviewsDir)
    mdName?: string        // "review.md"
    jsonName?: string      // "review.json"
  }

  /** Параметры рендера */
  render?: {
    template?: string          // abs/rel к repoRoot
    severityMap?: Record<string, string>
  }

  /** build-context options */
  context?: {
    includeADR?: boolean
    includeBoundaries?: boolean
    maxBytes?: number
    maxApproxTokens?: number
  }

  /** Аналитика (file JSONL sink + плагины) */
  analytics?: {
    enabled?: boolean
    /** byRun | byDay */
    mode?: 'byRun' | 'byDay'
    /** если не задано — берём <out.root>/<out.analyticsDir> */
    outDir?: string
    salt?: string
    privacy?: 'team' | 'detailed'
    plugins?: string[]
    pluginConfig?: Record<string, any>
  }
}

/** Разрешённая конфигурация с абсолютными путями */
export interface ResolvedConfig {
  repoRoot: string

  profile: string
  provider: ProviderName
  profilesDir: string

  failOn: FailOn
  maxComments?: number

  out: {
    rootAbs: string
    contextDirAbs: string
    reviewsDirAbs: string
    analyticsDirAbs: string
    exportsDirAbs: string
    mdName: string
    jsonName: string
  }

  render: {
    template?: string
    severityMap?: Record<string, string>
  }

  context: Required<Pick<NonNullable<SentinelRc['context']>, 'includeADR' | 'includeBoundaries' | 'maxBytes' | 'maxApproxTokens'>>

  analytics: {
    enabled: boolean
    mode: 'byRun' | 'byDay'
    outDir: string
    salt: string
    privacy: 'team' | 'detailed'
    plugins?: string[]
    pluginConfig?: Record<string, any>
  }
}

/* ──────────────────────────────────────────────────────────────────────────── */

const REPO_ROOT = findRepoRoot()

function readJsonSafe(p: string): any | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null }
}

/** Ищем ближайший .sentinelrc.json от CWD вверх до корня репо */
function findRc(startDir = process.cwd(), repoRoot = REPO_ROOT): string | null {
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

/** Глубокий merge только для 1 уровня вложенности (out/render/context/analytics) */
function mergeRc(base: SentinelRc, over?: SentinelRc): SentinelRc {
  if (!over) return base
  return {
    ...base,
    ...over,
    out: { ...(base.out || {}), ...(over.out || {}) },
    render: { ...(base.render || {}), ...(over.render || {}) },
    context: { ...(base.context || {}), ...(over.context || {}) },
    analytics: { ...(base.analytics || {}), ...(over.analytics || {}) },
  }
}

/** ENV → RC (только новый стандарт ключей) */
function envAsRc(): SentinelRc {
  const out: SentinelRc = {}

  if (process.env.SENTINEL_PROFILE) out.profile = process.env.SENTINEL_PROFILE
  if (process.env.SENTINEL_PROFILES_DIR) out.profilesDir = process.env.SENTINEL_PROFILES_DIR as string
  if (process.env.SENTINEL_PROVIDER) out.provider = process.env.SENTINEL_PROVIDER as ProviderName
  if (process.env.SENTINEL_FAIL_ON) out.failOn = process.env.SENTINEL_FAIL_ON as FailOn
  if (process.env.SENTINEL_MAX_COMMENTS) out.maxComments = Number(process.env.SENTINEL_MAX_COMMENTS)

  // out.*
  const outRoot   = process.env.SENTINEL_OUT_ROOT
  const outCtx    = process.env.SENTINEL_OUT_CONTEXT_DIR
  const outRev    = process.env.SENTINEL_OUT_REVIEWS_DIR
  const outAn     = process.env.SENTINEL_OUT_ANALYTICS_DIR
  const outExp    = process.env.SENTINEL_OUT_EXPORTS_DIR
  const outMdName = process.env.SENTINEL_OUT_MD_NAME
  const outJsonNm = process.env.SENTINEL_OUT_JSON_NAME
  if (outRoot || outCtx || outRev || outAn || outExp || outMdName || outJsonNm) {
    out.out = {
      ...(out.out || {}),
      ...(outRoot   ? { root: outRoot } : {}),
      ...(outCtx    ? { contextDir: outCtx } : {}),
      ...(outRev    ? { reviewsDir: outRev } : {}),
      ...(outAn     ? { analyticsDir: outAn } : {}),
      ...(outExp    ? { exportsDir: outExp } : {}),
      ...(outMdName ? { mdName: outMdName } : {}),
      ...(outJsonNm ? { jsonName: outJsonNm } : {}),
    }
  }

  // context.*
  const includeADR        = process.env.SENTINEL_CONTEXT_INCLUDE_ADR
  const includeBoundaries = process.env.SENTINEL_CONTEXT_INCLUDE_BOUNDARIES
  const maxBytes          = process.env.SENTINEL_CONTEXT_MAX_BYTES
  const maxTokens         = process.env.SENTINEL_CONTEXT_MAX_TOKENS
  if (includeADR || includeBoundaries || maxBytes || maxTokens) {
    out.context = {
      ...(out.context || {}),
      ...(includeADR ? { includeADR: includeADR === '1' || includeADR === 'true' } : {}),
      ...(includeBoundaries ? { includeBoundaries: includeBoundaries === '1' || includeBoundaries === 'true' } : {}),
      ...(maxBytes ? { maxBytes: Number(maxBytes) } : {}),
      ...(maxTokens ? { maxApproxTokens: Number(maxTokens) } : {}),
    }
  }

  // analytics.*
  const anEnabled = process.env.SENTINEL_ANALYTICS
  const anMode    = process.env.SENTINEL_ANALYTICS_MODE || process.env.SENTINEL_ANALYTICS_FILE_MODE
  const anDir     = process.env.SENTINEL_ANALYTICS_DIR
  const anSalt    = process.env.SENTINEL_ANALYTICS_SALT || process.env.SENTINEL_SALT
  const anPriv    = process.env.SENTINEL_ANALYTICS_PRIVACY
  if (anEnabled || anMode || anDir || anSalt || anPriv) {
    out.analytics = {
      ...(out.analytics || {}),
      ...(anEnabled ? { enabled: anEnabled === '1' || anEnabled === 'true' } : {}),
      ...(anMode ? { mode: (anMode as 'byRun' | 'byDay') } : {}),
      ...(anDir ? { outDir: anDir } : {}),
      ...(anSalt ? { salt: anSalt } : {}),
      ...(anPriv ? { privacy: (anPriv as 'team' | 'detailed') } : {}),
    }
  }

  return out
}

/** Значения по умолчанию — “хорошо и удобно” */
const defaults: Required<Pick<SentinelRc,
  'profile' | 'provider' | 'out' | 'context' | 'analytics'
>> = {
  profile: 'frontend',
  provider: 'local',
  out: {
    root: '.sentinel',
    contextDir: 'context',
    reviewsDir: 'reviews',
    analyticsDir: 'analytics',
    exportsDir: 'exports',
    mdName: 'review.md',
    jsonName: 'review.json',
  },
  context: {
    includeADR: true,
    includeBoundaries: true,
    maxBytes: 1_500_000,
    maxApproxTokens: 0,
  },
  analytics: {
    enabled: false,
    mode: 'byDay',
    outDir: '',      // будет вычислено из out.root/analyticsDir
    salt: 'sentinel',
    privacy: 'team',
    plugins: [],
    pluginConfig: {},
  },
}

/** Публичный загрузчик: defaults <- rc(file) <- env <- cli */
export function loadConfig(cliOverrides?: SentinelRc): ResolvedConfig {
  const rcPath = findRc()
  const fileRc = rcPath ? (readJsonSafe(rcPath) as SentinelRc || {}) : {}

  const merged = mergeRc(
    mergeRc(
      mergeRc(defaults, fileRc),
      envAsRc(),
    ),
    cliOverrides,
  )

  const repoRoot = REPO_ROOT

  // normalize & absolutize
  const out = merged.out || {}
  const outRootAbs = path.isAbsolute(out.root || '')
    ? (out.root as string)
    : path.join(repoRoot, out.root || '.sentinel')

  const contextDirAbs   = path.join(outRootAbs, out.contextDir   ?? 'context')
  const reviewsDirAbs   = path.join(outRootAbs, out.reviewsDir   ?? 'reviews')
  const analyticsDirAbs = path.join(outRootAbs, out.analyticsDir ?? 'analytics')
  const exportsDirAbs   = path.join(outRootAbs, out.exportsDir   ?? 'exports')

  const mdName   = out.mdName   ?? 'review.md'
  const jsonName = out.jsonName ?? 'review.json'

  const analytics = merged.analytics || {}
  const analyticsOutDirAbs = (() => {
    if (analytics.outDir && path.isAbsolute(analytics.outDir)) return analytics.outDir
    if (analytics.outDir) return path.join(repoRoot, analytics.outDir)
    // если не задано — берём стандарт из out.*
    return analyticsDirAbs
  })()

  const profilesDirAbs = (() => {
    const p = merged.profilesDir || 'packages/profiles'
    return path.isAbsolute(p) ? p : path.join(repoRoot, p)
  })()

  const render = merged.render || {}
  const renderTemplateAbs =
    render.template
      ? (path.isAbsolute(render.template) ? render.template : path.join(repoRoot, render.template))
      : undefined

  return {
    repoRoot,
    profile: merged.profile || 'frontend',
    provider: merged.provider || 'local',
    profilesDir: profilesDirAbs,
    failOn: merged.failOn || 'major',
    maxComments: merged.maxComments,

    out: {
      rootAbs: outRootAbs,
      contextDirAbs,
      reviewsDirAbs,
      analyticsDirAbs,
      exportsDirAbs,
      mdName,
      jsonName,
    },

    render: {
      template: renderTemplateAbs,
      severityMap: render.severityMap,
    },

    context: {
      includeADR: merged.context?.includeADR ?? true,
      includeBoundaries: merged.context?.includeBoundaries ?? true,
      maxBytes: merged.context?.maxBytes ?? 1_500_000,
      maxApproxTokens: merged.context?.maxApproxTokens ?? 0,
    },

    analytics: {
      enabled: !!analytics.enabled,
      mode: analytics.mode ?? 'byDay',
      outDir: analyticsOutDirAbs,
      salt: analytics.salt ?? 'sentinel',
      privacy: analytics.privacy ?? 'team',
      plugins: analytics.plugins,
      pluginConfig: analytics.pluginConfig,
    },
  }
}

export const _internal = { REPO_ROOT, findRc }
