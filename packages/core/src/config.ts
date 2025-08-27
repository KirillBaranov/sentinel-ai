import fs from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'

export type LanguageConfig = {
  input: 'ru' | 'en' | string
  output: 'ru' | 'en' | string
}

export type ProfileSelection = {
  name: 'frontend' | 'backend' | 'e2e' | string
  root: string // relative to repo root
}

export type LimitsConfig = {
  maxComments: number
  largePrThreshold: number
  truncateBytesPerFile: number
  truncateBytesPerADR: number
}

export type OutputConfig = {
  dual: boolean
  heading: string
  strict: boolean
  noIntro: boolean
  noOutro: boolean
}

export type RenderConfig = {
  showIcons: boolean
  compactMetaLine: boolean
  showFileLocatorFooter: boolean
}

export type PathsConfig = {
  rules: string
  boundaries: string
  handbook: string[]
  adrDir: string
}

export type ProvidersConfig = {
  openai?: { model?: string; temperature?: number; [k: string]: unknown }
  claude?: { model?: string; temperature?: number; [k: string]: unknown }
  mock?: { enabled?: boolean; [k: string]: unknown }
  [k: string]: unknown
}

export type SentinelConfig = {
  version: number
  language: LanguageConfig
  profile: ProfileSelection
  limits: LimitsConfig
  output: OutputConfig
  render: RenderConfig
  paths: PathsConfig
  providers?: ProvidersConfig
}

export type ResolvedProfilePaths = {
  profileName: string
  profileRootAbs: string
  rulesAbs: string
  boundariesAbs: string
  handbookAbs: string[]
  adrDirAbs: string
}

export type LoadedConfig = SentinelConfig & {
  resolved: ResolvedProfilePaths
}

/**
 * Defaults applied when fields are missing in sentinel.config.yml
 */
const DEFAULTS: SentinelConfig = {
  version: 1,
  language: { input: 'ru', output: 'ru' },
  profile: { name: 'frontend', root: './profiles' },
  limits: {
    maxComments: 7,
    largePrThreshold: 150,
    truncateBytesPerFile: 120_000,
    truncateBytesPerADR: 60_000,
  },
  output: {
    dual: true,
    heading: '## 🤖 Автоматический Code Review (advisory)',
    strict: true,
    noIntro: true,
    noOutro: true,
  },
  render: {
    showIcons: true,
    compactMetaLine: false,
    showFileLocatorFooter: true,
  },
  paths: {
    rules: 'docs/rules/rules.yml',
    boundaries: 'docs/rules/boundaries.json',
    handbook: [
      'docs/handbook/ARCHITECTURE.md',
      'docs/handbook/STYLEGUIDE.md',
      'docs/handbook/TESTING.md',
      'docs/handbook/ACCESSIBILITY.md',
      'docs/handbook/REVIEW_GUIDE.md',
    ],
    adrDir: 'docs/adr',
  },
  providers: {
    openai: { model: 'gpt-4.1', temperature: 0.2 },
    claude: { model: 'claude-3-5-sonnet', temperature: 0.2 },
    mock: { enabled: false },
  },
}

function readYamlSafe(file: string): any {
  try {
    const raw = fs.readFileSync(file, 'utf8')
    return parseYaml(raw)
  } catch (e) {
    return undefined
  }
}

function ensureNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function ensureBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

function ensureString(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback
}

function mergeConfig(base: SentinelConfig, override?: Partial<SentinelConfig>): SentinelConfig {
  if (!override) return base
  return {
    version: ensureNumber((override as any).version, base.version),
    language: {
      input: ensureString(override.language?.input, base.language.input),
      output: ensureString(override.language?.output, base.language.output),
    },
    profile: {
      name: ensureString(override.profile?.name, base.profile.name),
      root: ensureString(override.profile?.root, base.profile.root),
    },
    limits: {
      maxComments: ensureNumber(override.limits?.maxComments, base.limits.maxComments),
      largePrThreshold: ensureNumber(override.limits?.largePrThreshold, base.limits.largePrThreshold),
      truncateBytesPerFile: ensureNumber(override.limits?.truncateBytesPerFile, base.limits.truncateBytesPerFile),
      truncateBytesPerADR: ensureNumber(override.limits?.truncateBytesPerADR, base.limits.truncateBytesPerADR),
    },
    output: {
      dual: ensureBool(override.output?.dual, base.output.dual),
      heading: ensureString(override.output?.heading, base.output.heading),
      strict: ensureBool(override.output?.strict, base.output.strict),
      noIntro: ensureBool(override.output?.noIntro, base.output.noIntro),
      noOutro: ensureBool(override.output?.noOutro, base.output.noOutro),
    },
    render: {
      showIcons: ensureBool(override.render?.showIcons, base.render.showIcons),
      compactMetaLine: ensureBool(override.render?.compactMetaLine, base.render.compactMetaLine),
      showFileLocatorFooter: ensureBool(override.render?.showFileLocatorFooter, base.render.showFileLocatorFooter),
    },
    paths: {
      rules: ensureString(override.paths?.rules, base.paths.rules),
      boundaries: ensureString(override.paths?.boundaries, base.paths.boundaries),
      handbook: Array.isArray(override.paths?.handbook) && override.paths?.handbook.length
        ? override.paths!.handbook.map((p) => String(p))
        : base.paths.handbook,
      adrDir: ensureString(override.paths?.adrDir, base.paths.adrDir),
    },
    providers: { ...(base.providers || {}), ...(override.providers || {}) },
  }
}

function resolveProfilePaths(repoRoot: string, cfg: SentinelConfig): ResolvedProfilePaths {
  const profileRootAbs = path.resolve(repoRoot, cfg.profile.root, cfg.profile.name)
  const rulesAbs = path.resolve(profileRootAbs, cfg.paths.rules)
  const boundariesAbs = path.resolve(profileRootAbs, cfg.paths.boundaries)
  const handbookAbs = cfg.paths.handbook.map((p) => path.resolve(profileRootAbs, p))
  const adrDirAbs = path.resolve(profileRootAbs, cfg.paths.adrDir)
  return {
    profileName: cfg.profile.name,
    profileRootAbs,
    rulesAbs,
    boundariesAbs,
    handbookAbs,
    adrDirAbs,
  }
}

/**
 * Loads sentinel.config.yml from repo root (or provided cwd),
 * merges with defaults and environment overrides.
 *
 * ENV overrides (optional):
 * - SENTINEL_LANG_IN / SENTINEL_LANG_OUT
 * - SENTINEL_PROFILE
 */
export async function loadConfig(cwd: string = process.cwd()): Promise<LoadedConfig> {
  const configPath = path.resolve(cwd, 'sentinel.config.yml')
  const yamlCfg = readYamlSafe(configPath)

  let merged = mergeConfig(DEFAULTS, yamlCfg)

  // Basic env overrides
  if (process.env.SENTINEL_LANG_IN) merged.language.input = String(process.env.SENTINEL_LANG_IN)
  if (process.env.SENTINEL_LANG_OUT) merged.language.output = String(process.env.SENTINEL_LANG_OUT)
  if (process.env.SENTINEL_PROFILE) merged.profile.name = String(process.env.SENTINEL_PROFILE)

  const resolved = resolveProfilePaths(cwd, merged)

  // Light validation (no heavy deps)
  const missing: string[] = []
  if (!fs.existsSync(resolved.rulesAbs)) missing.push(`rules.yml missing: ${resolved.rulesAbs}`)
  if (!fs.existsSync(resolved.boundariesAbs)) missing.push(`boundaries.json missing: ${resolved.boundariesAbs}`)
  for (const f of resolved.handbookAbs) if (!fs.existsSync(f)) missing.push(`handbook missing: ${f}`)
  if (missing.length) {
    // Non-fatal: tools may still run with partial context
    console.warn(`[sentinel-config] Warnings:\n- ${missing.join('\n- ')}`)
  }

  return Object.freeze({ ...merged, resolved })
}

// Small helper to expose just the resolved paths (for tools)
export async function getResolvedProfilePaths(cwd?: string): Promise<ResolvedProfilePaths> {
  const cfg = await loadConfig(cwd)
  return cfg.resolved
}