import { sevRank, maxSeverity } from '../cli-utils'
import { it } from 'vitest'
import { expect } from 'vitest'

it('maxSeverity ranking', () => {
  const top = maxSeverity([
    { severity: 'minor' },
    { severity: 'critical' },
    { severity: 'major' },
  ] as any)
  expect(top).toBe('critical')
})
