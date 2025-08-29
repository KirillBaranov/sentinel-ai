import type { ReviewJson, RulesJson } from '@sentinel/core'

export type ProviderReviewInput = {
  diffText: string
  profile: string
  rules: RulesJson | null
  boundaries?: unknown // провайдер может сам парсить свою структуру
  contextPath?: string // путь к dist/ai-review-context.md (если нужно LLM)
}

export interface ReviewProvider {
  name: string
  review(input: ProviderReviewInput): Promise<ReviewJson>
}
