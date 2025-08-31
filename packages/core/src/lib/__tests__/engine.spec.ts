
import { describe, it, expect } from 'vitest'
import { analyzeDiff, defaultMetaFor } from '../engine'
import { makeFingerprint, type ReviewFinding } from '../normalize'
import type { BoundariesConfig } from '../boundaries'
import type { RuleItem } from '../types'

function makeDiff(text: string, file = 'src/features/a/file.ts') {
  return [
    'diff --git a/src/features/a/file.ts b/src/features/a/file.ts',
    '--- a/src/features/a/file.ts',
    `+++ b/${file}`,
    '@@ -1,0 +1,1 @@',
    `+${text}`, // ВАЖНО: добавленная строка в unified diff начинается с "+"
    ''
  ].join('\n')
}

describe('defaultMetaFor', () => {
  it('returns from rules map when available', () => {
    const rules = new Map<string, RuleItem>()
    rules.set('rule.x', {
      id: 'rule.x',
      area: 'Security',
      severity: 'critical',
      description: '',
      link: '',
      examples: {},
      scope: [],
      trigger: { type: 'pattern', signals: [] },
      status: 'active',
      version: 1,
    })
    expect(defaultMetaFor('rule.x', rules)).toEqual({ area: 'Security', severity: 'critical' })
  })

  it('falls back to Style/minor when rule not found', () => {
    expect(defaultMetaFor('nope', undefined)).toEqual({ area: 'Style', severity: 'minor' })
    expect(defaultMetaFor('no-such', new Map())).toEqual({ area: 'Style', severity: 'minor' })
  })
})

describe('analyzeDiff', () => {
  it('detects TODO line comment', () => {
    const diff = makeDiff('// TODO: fix this')
    const findings = analyzeDiff({ diffText: diff })
    expect(findings).toHaveLength(1)
    const f = findings[0]
    expect(f.rule).toBe('style.no-todo-comment')
    expect(f.locator).toBe('L1')
    expect(f.finding[0]).toMatch(/TODO/)
    expect(f.why).toMatch(/TODO/i)
    expect(f.suggestion).toMatch(/ticket/i)
    // fingerprint is stable for same input
    expect(f.fingerprint).toBe(
      makeFingerprint(f.rule, f.file, f.locator, '// TODO: fix this')
    )
  })

  it('detects TODO in block comment', () => {
    const diff = makeDiff('/* TODO: later */')
    const findings = analyzeDiff({ diffText: diff })
    expect(findings.map(f => f.rule)).toContain('style.no-todo-comment')
  })

  it('detects arch.modular-boundaries import', () => {
    const diff = makeDiff(`import x from 'feature-b/internal/utils'`, 'src/features/a/foo.ts')
    const rules = new Map<string, RuleItem>()
    rules.set('arch.modular-boundaries', {
      id: 'arch.modular-boundaries',
      area: 'Architecture',
      severity: 'critical',
      description: 'desc',
      link: '',
      examples: {},
      scope: [],
      trigger: { type: 'pattern', signals: [] },
      status: 'active',
      version: 1,
    })
    const findings = analyzeDiff({ diffText: diff, rulesById: rules })
    expect(findings).toHaveLength(1)
    const f = findings[0]
    expect(f.rule).toBe('arch.modular-boundaries')
    expect(f.area).toBe('Architecture')
    expect(f.severity).toBe('critical')
    expect(f.finding[0]).toMatch(/Cross-feature internal/i)
  })

  it('detects boundaries violation via config', () => {
    const diff = makeDiff(`import x from '../b/internal/foo'`, 'src/features/a/index.ts')
    const boundaries: BoundariesConfig = {
      layers: [{ name: 'feature', path: 'src/features/a/**', index: 2 }],
      forbidden: [
        {
          rule: 'feature-to-feature-internal',
          from: { glob: 'src/features/a/**' },
          to: { glob: '**/internal/**' }, // шире, чтобы матчить относительные пути
          explain: 'no cross feature',
        },
      ],
    }
    const rules = new Map<string, RuleItem>()
    rules.set('boundaries.feature-to-feature-internal', {
      id: 'boundaries.feature-to-feature-internal',
      area: 'Architecture',
      severity: 'major',
      description: '',
      link: '',
      examples: {},
      scope: [],
      trigger: { type: 'pattern', signals: [] },
      status: 'active',
      version: 1,
    })

    const findings = analyzeDiff({ diffText: diff, rulesById: rules, boundaries })
    expect(findings).toHaveLength(1)
    const f = findings[0]
    expect(f.rule).toBe('boundaries.feature-to-feature-internal')
    expect(f.area).toBe('Architecture')
    expect(f.severity).toBe('major')
    expect(f.why).toBe('no cross feature')
    expect(f.finding[0]).toMatch(/Forbidden import/i)
  })

  it('returns empty when no violations', () => {
    const diff = makeDiff('const ok = 42')
    const findings = analyzeDiff({ diffText: diff })
    expect(findings).toEqual([])
  })

  it('generates distinct fingerprints for different findings', () => {
    const diff = makeDiff('// TODO: one') + '\n' + makeDiff('// TODO: two')
    const findings = analyzeDiff({ diffText: diff })
    const fps = findings.map(f => f.fingerprint)
    expect(new Set(fps).size).toBe(fps.length)
  })
})
