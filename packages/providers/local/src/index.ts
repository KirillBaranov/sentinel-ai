import type { ReviewJson, BoundariesConfig } from '@sentinel/core'
import type { ReviewProvider, ProviderReviewInput } from '../../types/dist/src'
import { analyzeDiff } from '@sentinel/core'

export { analyzeDiff }

export const localProvider: ReviewProvider = {
  name: 'local',
  async review(input: ProviderReviewInput): Promise<ReviewJson> {
    const findings = analyzeDiff({
      diffText: input.diffText,
      rulesById: undefined,
      rulesJson: input.rules ?? null,
      boundaries: (input.boundaries as BoundariesConfig) ?? null,
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
