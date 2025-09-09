import { runStaticEngine, type EngineOptions } from '../engine'
import type { RulesJson, ReviewFinding } from '../types'

export interface AnalyzeDiffInput {
  diffText: string
  rulesJson: RulesJson | null
  options?: EngineOptions
}

export function analyzeDiff(input: AnalyzeDiffInput): ReviewFinding[] {
  const res = runStaticEngine({
    diffText: input.diffText,
    rules: input.rulesJson ?? null,
    options: input.options,
  })
  return res.findings
}
