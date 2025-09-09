import type {
  ReviewJson,
  ReviewFinding,
  RulesJson,
  Severity,
} from '@sentinel/core'

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

/** Optional: compact hint for LLM from the core static engine */
export interface CorePlanItem {
  rule_id: string
  file: string
  locator: string
  snippet: string
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

  /**
   * Hints from core static analysis to focus LLM attention.
   * Providers MAY include these in prompts; safe to ignore.
   */
  planFromCore?: CorePlanItem[]

  /**
   * Read-only static findings produced by the core (pre-LLM).
   * Providers MUST NOT mutate this; can reference in prompts.
   */
  staticFindings?: Array<{
    rule: string
    area: string
    severity: Severity
    file: string
    locator: string
    finding: string[]
    why: string
    suggestion: string
    fingerprint: string
  }>
}

/**
 * Minimal provider contract: name + async review method.
 */
export interface ReviewProvider {
  name: string
  review(input: ProviderReviewInput): Promise<ReviewJson>
}

export type ProviderReviewOutput = ReviewJson

/**
 * Small helper to construct a valid provider output envelope.
 */
export function buildProviderOutput(
  findings: ReviewFinding[],
  runId?: string,
): ProviderReviewOutput {
  return {
    ai_review: {
      version: 1 as const,
      run_id: runId ?? `run_${Date.now()}`,
      findings,
    },
  }
}
