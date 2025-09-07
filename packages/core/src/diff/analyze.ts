import type { RulesJson, BoundariesConfig, ReviewFinding } from '../types'
import { runStaticEngine } from '../engine'
import { normalizeFindings } from '../postprocess/normalize'

export interface AnalyzeDiffInput {
  diffText: string
  rulesJson: RulesJson | null
  boundaries?: BoundariesConfig | null
}

export function analyzeDiff(input: AnalyzeDiffInput): ReviewFinding[] {
  const raw = runStaticEngine({
    diffText: input.diffText,
    rules: input.rulesJson ?? null,
  })

  return normalizeFindings(raw)
}
