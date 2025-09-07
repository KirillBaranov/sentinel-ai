export type Severity = 'critical' | 'major' | 'minor' | 'info'

export interface SeverityMap {
  title: Record<Severity, string>
  icon: Record<Severity, string>
  order: Severity[]
}

export interface ReviewFinding {
  rule: string
  area: string
  severity: Severity
  file: string
  locator: string        // "L42" | "L10-L20" | "HUNK:@@ -a,b +c,d @@"
  finding: string[]      // ["[L42] message", ...]
  why: string
  suggestion: string
  fingerprint: string
}

export interface BoundariesRule {
  id: string
  files: string[]
  allowedImports?: string[]
}

export interface BoundariesConfig {
  version: number
  domain: string
  boundaries: BoundariesRule[]
}

export type TriggerType = 'pattern' | 'heuristic' | 'hybrid' | 'llm'

export interface RuleTrigger {
  type: TriggerType
  evidence?: 'added-only' | 'diff-any'
  requireSignalMatch?: boolean
  signals?: string[]
  exempt?: string[]
  file_glob?: string[]
}

export interface Rule {
  id: string
  area: string
  severity: Severity
  description?: string
  trigger?: RuleTrigger
  status?: 'active' | 'disabled'
  version?: number
}

export interface RulesJson {
  version: number
  domain: string
  rules: Rule[]
}

export type AddedLine = { line: number; text: string }

export interface DiffIndex {
  /** Список файлов из диффа (путь после `+++ b/…`) */
  files: string[]
  /** Карта: файл -> добавленные строки (с реальными номерами) */
  addedByFile: Record<string, AddedLine[]>
  /** Весь diff на случай расширенной логики */
  raw: string
}

export interface RuleConstraint {
  id: string
  area?: string
  severity?: Severity
  evidence: 'added-only' | 'diff-any'
  requireSignalMatch: boolean
  signals: string[]
  exempt: string[]
  file_glob?: string[]
}

export interface GateResult {
  /** Можно ли вообще репортить по этому правилу в текущем файле */
  allowed: boolean
  /** Нужен ли буквальный матч по сигналам */
  needsSignal: boolean
  /** Пул строк, по которым надо матчить сигналы/исключения */
  evidenceLines: string[]
}

export interface CorePlanLLMTask {
  rule_id: string
  file: string
  locator: string
  /** Небольшой сниппет контекста, который провайдер может подсунуть в prompt */
  snippet: string
}

export interface CoreResult {
  findings: ReviewFinding[]
  /** Заявки к LLM: «проверь глубже вот это место», если статикой недостает уверенности */
  llm_tasks: CorePlanLLMTask[]
}

/**
 * Debug controls passed into a provider.
 * If `enabled` (or `debug`) is true, the provider may dump inputs/prompts
 * into `dir` (absolute) for easier troubleshooting.
 */
export interface ProviderDebug {
  /** Master switch for debug mode */
  enabled: boolean
  /** Alias/flag that some providers check directly */
  debug: boolean
  /** Absolute path to a directory for debug artifacts */
  dir: string
}

/**
 * Normalized, provider-agnostic options for LLM-like providers.
 */
export interface ProviderOptions {
  model?: string
  temperature?: number
  maxTokens?: number
}

/**
 * Canonical input shape every review provider receives from the CLI.
 * Keep this stable; add only backwards-compatible fields.
 */
export interface ProviderReviewInput {
  /** Absolute repo root detected by CLI */
  repoRoot: string
  /** Selected profile name (e.g. "frontend") */
  profile: string
  /** Unified diff text (as produced by `git diff --unified=0`) */
  diffText: string
  /** Optional profile rulebook (full JSON object) */
  rules?: RulesJson | any
  /** Optional module boundaries/config */
  boundaries?: any
  /** Optional prebuilt context for the provider (markdown) */
  context?: { markdown: string; maxBytes?: number }
  /** Provider-agnostic LLM options */
  providerOptions?: ProviderOptions
  /** Debug configuration (when CLI enables provider debug mode) */
  debug?: ProviderDebug
}

export interface ReviewJson {
  ai_review: {
    version: 1
    run_id: string
    findings: ReviewFinding[]
  }
}

/**
 * Providers should return the canonical review envelope.
 */
export type ProviderReviewOutput = ReviewJson
