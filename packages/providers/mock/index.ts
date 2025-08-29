import type { ReviewProvider } from '@sentinel/provider-types'
import type { ReviewJson, BoundariesConfig, RulesJson } from '@sentinel/core'

// Mock provider - простая заглушка, которая возвращает 1–2 фиктивных замечания
export const mockProvider: ReviewProvider = {
  name: 'mock',
  async review(input: {
    diffText: string
    profile: string
    rules?: RulesJson | null
    boundaries?: BoundariesConfig | null
  }): Promise<ReviewJson> {
    const findings = []

    // примитивные сигналы, чтобы было видно, что провайдер «работает»
    if (/TODO/i.test(input.diffText)) {
      findings.push({
        rule: 'style.no-todo-comment',
        area: 'DX',
        severity: 'minor',
        file: 'unknown',
        locator: 'L0',
        finding: ['TODO comment found'],
        why: 'Inline TODOs get stale and hide tech debt.',
        suggestion: 'Replace with a link to a tracked ticket (issue/ID) and remove the inline TODO.',
        fingerprint: 'mock-fp-todo'
      })
    }
    if (/\/internal\b/.test(input.diffText)) {
      findings.push({
        rule: 'arch.modular-boundaries',
        area: 'Architecture',
        severity: 'critical',
        file: 'unknown',
        locator: 'L0',
        finding: ['Cross-feature internal import'],
        why: 'Features must not import each other directly; this couples internals.',
        suggestion: 'Use shared adapter/port or the feature public API.',
        fingerprint: 'mock-fp-internal'
      })
    }

    return {
      ai_review: {
        version: 1,
        run_id: `mock_${Date.now()}`,
        findings
      }
    }
  }
}

export default mockProvider
