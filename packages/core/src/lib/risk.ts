import type { Severity } from './types.js'

export type RiskWeights = Partial<Record<Severity, number>>
export type RiskThresholds = { high: number; medium: number }

export interface RiskConfig {
  enabled?: boolean
  weights?: RiskWeights
  thresholds?: RiskThresholds
}

export interface ScoreInput {
  counts: Record<Severity, number>
}

export interface ScoreOutput {
  score: number            // 0..100
  level: 'low' | 'medium' | 'high'
  detail: { weights: Required<Record<Severity, number>> }
}

export const DEFAULT_WEIGHTS: Required<Record<Severity, number>> = {
  critical: 100, major: 50, minor: 10, info: 0
}

export const DEFAULT_THRESHOLDS: RiskThresholds = { high: 60, medium: 30 }

export function scoreFindings(
  input: ScoreInput,
  cfg?: RiskConfig
): ScoreOutput {
  const weights = { ...DEFAULT_WEIGHTS, ...(cfg?.weights || {}) }
  const total = (input.counts.critical ?? 0)
             + (input.counts.major ?? 0)
             + (input.counts.minor ?? 0)
             + (input.counts.info ?? 0)

  if (total <= 0) {
    return { score: 0, level: 'low', detail: { weights } }
  }

  const weighted =
    (input.counts.critical ?? 0) * weights.critical +
    (input.counts.major ?? 0)    * weights.major +
    (input.counts.minor ?? 0)    * weights.minor +
    (input.counts.info ?? 0)     * weights.info

  // Нормируем «на finding» в 0..100
  const raw = weighted / total
  const score = Math.max(0, Math.min(100, Math.round(raw)))

  const t = cfg?.thresholds || DEFAULT_THRESHOLDS
  const level = score >= t.high ? 'high' : score >= t.medium ? 'medium' : 'low'

  return { score, level, detail: { weights } }
}
