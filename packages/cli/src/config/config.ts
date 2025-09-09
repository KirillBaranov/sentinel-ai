import fs from 'node:fs'
import path from 'node:path'
import { findRepoRoot } from '../cli-utils'

export type FailOn = 'major' | 'critical'
export type ProviderName = 'local' | 'mock' | 'openai' | 'claude'

/** Универсальные опции провайдера (оба LLM-провайдера их поддерживают) */
export interface CommonProviderOptions {
  model?: string
  temperature?: number
  maxTokens?: number
}

export interface SentinelRc {
  profile?: string
  provider?: string            // допускаем произвольный кейс, нормализуем ниже
  profilesDir?: string

  failOn?: FailOn
  maxComments?: number

  out?: {
    root?: string
    contextDir?: string
    reviewsDir?: string
    analyticsDir?: string
    exportsDir?: string
    mdName?: string
    jsonName?: string
  }

  render?: {
    template?: string
    severityMap?: Record<string, string>
  }

  context?: {
    includeADR?: boolean
    includeBoundaries?: boolean
    maxBytes?: number
    maxApproxTokens?: number
  }

  analytics?: {
    enabled?: boolean
    mode?: 'byRun' | 'byDay'
    outDir?: string
    salt?: string
    privacy?: 'team' | 'detailed'
    plugins?: string[]
    pluginConfig?: Record<string, any>
  }

  providerOptions?: CommonProviderOptions
}

/** Разрешённая конфигурация (абсолютные пути и дефолты) */
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

  providerOptions: Required<CommonProviderOptions>
}

/* ──────────────────────────────────────────────────────────────────────────── */

const REPO_ROOT = findRepoRoot()
const VALID_PROVIDERS = new Set<ProviderName>(['local', 'mock', 'openai', 'claude'])

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

/** tiny helper: копируем только определённые (не undefined) поля */
function pickDefined<T extends Record<string, any>>(obj: T | undefined): Partial<T> {
  if (!obj) return {}
  const out: Partial<T> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) (out as any)[k] = v
  }
  return out
}

/** Глубокий merge, игнорирующий undefined (ключ к багу) */
function mergeRc(base: SentinelRc, over?: SentinelRc): SentinelRc {
  if (!over) return base
  return {
    ...base,
    // верхний уровень — только определённые ключи
    ...pickDefined({
      profile: over.profile,
      provider: over.provider,
      profilesDir: over.profilesDir,
      failOn: over.failOn,
      maxComments: over.maxComments,
    }),
    // вложенные блоки — тоже через pickDefined
    out: { ...(base.out || {}), ...pickDefined(over.out) },
    render: { ...(base.render || {}), ...pickDefined(over.render) },
    context: { ...(base.context || {}), ...pickDefined(over.context) },
    analytics: { ...(base.analytics || {}), ...pickDefined(over.analytics) },
    providerOptions: { ...(base.providerOptions || {}), ...pickDefined(over.providerOptions) },
  }
}

/** ENV → RC (новые ключи + алиасы для LLM) */
function envAsRc(): SentinelRc {
  const out: SentinelRc = {}

  if (process.env.SENTINEL_PROFILE) out.profile = process.env.SENTINEL_PROFILE
  if (process.env.SENTINEL_PROFILES_DIR) out.profilesDir = process.env.SENTINEL_PROFILES_DIR
  if (process.env.SENTINEL_PROVIDER) out.provider = process.env.SENTINEL_PROVIDER
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
    out.out = pickDefined({
      ...(out.out || {}),
      root: outRoot,
      contextDir: outCtx,
      reviewsDir: outRev,
      analyticsDir: outAn,
      exportsDir: outExp,
      mdName: outMdName,
      jsonName: outJsonNm,
    })
  }

  // context.*
  const includeADR        = process.env.SENTINEL_CONTEXT_INCLUDE_ADR
  const includeBoundaries = process.env.SENTINEL_CONTEXT_INCLUDE_BOUNDARIES
  const maxBytes          = process.env.SENTINEL_CONTEXT_MAX_BYTES
  const maxTokens         = process.env.SENTINEL_CONTEXT_MAX_TOKENS
  if (includeADR || includeBoundaries || maxBytes || maxTokens) {
    out.context = pickDefined({
      ...(out.context || {}),
      includeADR: includeADR === undefined ? undefined : (includeADR === '1' || includeADR === 'true'),
      includeBoundaries: includeBoundaries === undefined ? undefined : (includeBoundaries === '1' || includeBoundaries === 'true'),
      maxBytes: maxBytes ? Number(maxBytes) : undefined,
      maxApproxTokens: maxTokens ? Number(maxTokens) : undefined,
    })
  }

  // analytics.*
  const anEnabled = process.env.SENTINEL_ANALYTICS
  const anMode    = process.env.SENTINEL_ANALYTICS_MODE || process.env.SENTINEL_ANALYTICS_FILE_MODE
  const anDir     = process.env.SENTINEL_ANALYTICS_DIR
  const anSalt    = process.env.SENTINEL_ANALYTICS_SALT || process.env.SENTINEL_SALT
  const anPriv    = process.env.SENTINEL_ANALYTICS_PRIVACY
  if (anEnabled || anMode || anDir || anSalt || anPriv) {
    out.analytics = pickDefined({
      ...(out.analytics || {}),
      enabled: anEnabled === undefined ? undefined : (anEnabled === '1' || anEnabled === 'true'),
      mode: anMode as any,
      outDir: anDir,
      salt: anSalt,
      privacy: anPriv as any,
    })
  }

  // providerOptions (универсальные + алиасы)
  const pModel = process.env.SENTINEL_PROVIDER_MODEL
  const pTemp  = process.env.SENTINEL_PROVIDER_TEMPERATURE
  const pMax   = process.env.SENTINEL_PROVIDER_MAX_TOKENS
  const oModel = process.env.OPENAI_MODEL
  const oTemp  = process.env.OPENAI_TEMPERATURE
  const oMax   = process.env.OPENAI_MAX_TOKENS
  const cModel = process.env.CLAUDE_MODEL
  const cTemp  = process.env.CLAUDE_TEMPERATURE
  const cMax   = process.env.CLAUDE_MAX_TOKENS

  const anyPO = pModel || pTemp || pMax || oModel || oTemp || oMax || cModel || cTemp || cMax
  if (anyPO) {
    out.providerOptions = pickDefined({
      ...(out.providerOptions || {}),
      model: pModel || oModel || cModel,
      temperature: pTemp ? Number(pTemp) : (oTemp ? Number(oTemp) : (cTemp ? Number(cTemp) : undefined)),
      maxTokens: pMax ? Number(pMax) : (oMax ? Number(oMax) : (cMax ? Number(cMax) : undefined)),
    })
  }

  return out
}

/** Значения по умолчанию */
const defaults: Required<Pick<SentinelRc,
  'profile' | 'out' | 'context' | 'analytics'
>> & Pick<SentinelRc, 'provider' | 'providerOptions'> = {
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
    outDir: '',
    salt: 'sentinel',
    privacy: 'team',
    plugins: [],
    pluginConfig: {},
  },
  providerOptions: {},
}

/** Нормализация ID провайдера */
function sanitizeProvider(v?: string): ProviderName {
  const key = (v || '').toLowerCase() as ProviderName
  return VALID_PROVIDERS.has(key) ? key : 'local'
}

/** Публичный загрузчик: defaults <- rc(file) <- env <- cli */
export function loadConfig(cliOverrides?: SentinelRc): ResolvedConfig {
  const rcPath = findRc()
  const fileRc = rcPath ? (readJsonSafe(rcPath) as SentinelRc || {}) : {}

  // ВАЖНО: mergeRc теперь игнорирует undefined → CLI не сможет случайно затереть provider
  const mergedRaw = mergeRc(
    mergeRc(
      mergeRc(defaults, fileRc),
      envAsRc(),
    ),
    cliOverrides,
  )

  const repoRoot = REPO_ROOT

  // provider — строго нормализуем
  const provider = sanitizeProvider(mergedRaw.provider)

  // normalize & absolutize
  const out = mergedRaw.out || {}
  const outRootAbs = path.isAbsolute(out.root || '')
    ? (out.root as string)
    : path.join(repoRoot, out.root || '.sentinel')

  const contextDirAbs   = path.join(outRootAbs, out.contextDir   ?? 'context')
  const reviewsDirAbs   = path.join(outRootAbs, out.reviewsDir   ?? 'reviews')
  const analyticsDirAbs = path.join(outRootAbs, out.analyticsDir ?? 'analytics')
  const exportsDirAbs   = path.join(outRootAbs, out.exportsDir   ?? 'exports')

  const mdName   = out.mdName   ?? 'review.md'
  const jsonName = out.jsonName ?? 'review.json'

  const analytics = mergedRaw.analytics || {}
  const analyticsOutDirAbs = (() => {
    if (analytics.outDir && path.isAbsolute(analytics.outDir)) return analytics.outDir
    if (analytics.outDir) return path.join(repoRoot, analytics.outDir)
    return analyticsDirAbs
  })()

  const profilesDirAbs = (() => {
    const p = mergedRaw.profilesDir || 'packages/profiles'
    return path.isAbsolute(p) ? p : path.join(repoRoot, p)
  })()

  const render = mergedRaw.render || {}
  const renderTemplateAbs =
    render.template
      ? (path.isAbsolute(render.template) ? render.template : path.join(repoRoot, render.template))
      : undefined

  // Дефолты по провайдерам
  const defaultsByProvider = (prov: ProviderName): Required<CommonProviderOptions> => {
    switch (prov) {
      case 'openai': return { model: 'gpt-4o-mini', temperature: 0.1, maxTokens: 1500 }
      case 'claude': return { model: 'claude-3-haiku-20240307', temperature: 0.1, maxTokens: 1500 }
      default:       return { model: '', temperature: 0.0, maxTokens: 0 }
    }
  }

  // Итоговые providerOptions:
  let providerOptions: Required<CommonProviderOptions> = {
    ...defaultsByProvider(provider),
    ...(mergedRaw.providerOptions || {}),
  }

  // Для local/mock — опции модели неактуальны (обнуляем, чтобы не путать)
  if (provider === 'local' || provider === 'mock') {
    providerOptions = defaultsByProvider(provider)
  }

  // warnings, если OPENAI_*/CLAUDE_* есть, а провайдер другой
  const envHasOpenAI =
    !!process.env.OPENAI_MODEL || !!process.env.OPENAI_TEMPERATURE || !!process.env.OPENAI_MAX_TOKENS
  const envHasClaude =
    !!process.env.CLAUDE_MODEL || !!process.env.CLAUDE_TEMPERATURE || !!process.env.CLAUDE_MAX_TOKENS
  if (envHasOpenAI && provider !== 'openai') {
    console.warn('[sentinel:config] OPENAI_* заданы, но provider != "openai" → опции OpenAI игнорируются.')
  }
  if (envHasClaude && provider !== 'claude') {
    console.warn('[sentinel:config] CLAUDE_* заданы, но provider != "claude" → опции Claude игнорируются.')
  }

  return {
    repoRoot,
    profile: mergedRaw.profile || 'frontend',
    provider,
    profilesDir: profilesDirAbs,
    failOn: mergedRaw.failOn || 'major',
    maxComments: mergedRaw.maxComments,

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
      includeADR: mergedRaw.context?.includeADR ?? true,
      includeBoundaries: mergedRaw.context?.includeBoundaries ?? true,
      maxBytes: mergedRaw.context?.maxBytes ?? 1_500_000,
      maxApproxTokens: mergedRaw.context?.maxApproxTokens ?? 0,
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

    providerOptions,
  }
}

export const _internal = { REPO_ROOT, findRc }
