import type {
  ReviewJson,
  ReviewFinding,
  RulesJson,
} from '@sentinel/core'

export type ProviderBoundaries = unknown

export type ProviderReviewInput = {
  diffText: string
  profile: string
  rules: RulesJson | null
  boundaries?: ProviderBoundaries
  contextPath?: string
  options?: Record<string, unknown>
}

export type ProviderReviewOutput = ReviewJson

export interface ReviewProvider {
  name: string
  review(input: ProviderReviewInput): Promise<ProviderReviewOutput>
}

export function buildProviderOutput(findings: ReviewFinding[], runId?: string): ProviderReviewOutput {
  return {
    ai_review: {
      version: 1,
      run_id: runId ?? `run_${Date.now()}`,
      findings,
    }
  }
}
