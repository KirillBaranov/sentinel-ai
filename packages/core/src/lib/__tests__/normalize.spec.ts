import { describe, it, expect } from 'vitest'
import { groupBySeverity, sha1, makeFingerprint, type ReviewFinding } from '../normalize'

describe('groupBySeverity', () => {
  const base = {
    rule: 'x',
    area: 'Style',
    file: 'a.ts',
    locator: 'L1',
    finding: ['[L1] msg'],
    why: 'because',
    suggestion: 'do it',
    fingerprint: 'fp',
  }

  it('returns map with all severities in canonical order', () => {
    const findings: ReviewFinding[] = [
      { ...base, severity: 'minor' },
      { ...base, severity: 'critical' },
      { ...base, severity: 'info' },
      { ...base, severity: 'major' },
    ]

    const res = groupBySeverity(findings)
    // порядок фиксированный
    expect(res.order).toEqual(['critical', 'major', 'minor', 'info'])

    // в мапе есть все ключи и элементы разложены по группам
    expect(res.map.get('critical')!.length).toBe(1)
    expect(res.map.get('major')!.length).toBe(1)
    expect(res.map.get('minor')!.length).toBe(1)
    expect(res.map.get('info')!.length).toBe(1)
  })

  it('initializes empty arrays for missing severities', () => {
    const findings: ReviewFinding[] = [
      { ...base, severity: 'major' },
      { ...base, severity: 'major' },
    ]
    const res = groupBySeverity(findings)

    expect(res.map.get('major')!.length).toBe(2)
    expect(res.map.get('critical')!.length).toBe(0)
    expect(res.map.get('minor')!.length).toBe(0)
    expect(res.map.get('info')!.length).toBe(0)
  })
})

describe('sha1', () => {
  it('computes known SHA1 digest', () => {
    // классическое значение SHA1('abc')
    expect(sha1('abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
  })

  it('is sensitive to content changes', () => {
    const a = sha1('hello')
    const b = sha1('hello!')
    expect(a).not.toBe(b)
  })
})

describe('makeFingerprint', () => {
  it('is deterministic for the same inputs', () => {
    const fp1 = makeFingerprint('rule.x', 'src/a.ts', 'L10', '[L10] something')
    const fp2 = makeFingerprint('rule.x', 'src/a.ts', 'L10', '[L10] something')
    expect(fp1).toBe(fp2)
  })

  it('changes when any component changes', () => {
    const base = makeFingerprint('r', 'f.ts', 'L1', '[L1] msg')

    expect(makeFingerprint('r2', 'f.ts', 'L1', '[L1] msg')).not.toBe(base)
    expect(makeFingerprint('r', 'g.ts', 'L1', '[L1] msg')).not.toBe(base)
    expect(makeFingerprint('r', 'f.ts', 'L2', '[L1] msg')).not.toBe(base)
    expect(makeFingerprint('r', 'f.ts', 'L1', '[L1] msg changed')).not.toBe(base)
  })
})
