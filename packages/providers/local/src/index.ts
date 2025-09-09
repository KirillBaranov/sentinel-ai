// packages/providers/local/src/index.ts
import path from 'node:path'
import { analyzeDiff, type RulesJson } from '@sentinel/core'
import { buildProviderOutput, type ReviewProvider, type ProviderReviewInput } from '@sentinel/provider-types'
import type { ReviewJson } from '@sentinel/core'

export const localProvider: ReviewProvider = {
  name: 'local',
  async review(input: ProviderReviewInput): Promise<ReviewJson> {
    const findings = analyzeDiff({
      diffText: input.diffText,
      rulesJson: (input.rules as RulesJson) ?? null,
      options: {
        debug: !!input.debug?.enabled,
        debugDir: input.debug?.dir ? path.resolve(input.debug.dir) : undefined,

        strictSignals: true,
        capPerRulePerFile: 3,
        capPerRuleTotal: 50,
      },
    })

    return buildProviderOutput(findings)
  },
}

export default localProvider
