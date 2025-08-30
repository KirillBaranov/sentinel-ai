import type { ReviewJson } from '@sentinel/core'
import type { ReviewProvider, ProviderReviewInput } from '@sentinel/provider-types'
import { analyzeDiff } from './engine.js'

export const localProvider: ReviewProvider = {
  name: 'local',
  async review(input: ProviderReviewInput): Promise<ReviewJson> {
    const findings = analyzeDiff({
      diffText: input.diffText,
      rulesById: undefined,           // провайдер может сам подмешать знания, если нужно
      rulesJson: input.rules ?? null,
      boundaries: input.boundaries ?? null,
    })

    return {
      ai_review: {
        version: 1,
        run_id: `run_${Date.now()}`,
        findings,
      }
    }
  }
}

export default localProvider
