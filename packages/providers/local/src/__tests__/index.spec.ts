import { describe, it, expect } from 'vitest'
import { localProvider } from '../index'
import type { BoundariesConfig } from '@sentinel/core'
import type { RulesJson } from '@sentinel/core'

function makeDiff(text: string, file = 'src/features/a/file.ts') {
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    '@@ -1,0 +1,1 @@',
    `+${text}`,
    ''
  ].join('\n')
}

function makeRulesJson(partial?: Partial<RulesJson>): RulesJson {
  return {
    version: 1,
    domain: 'test',
    rules: [
      {
        id: 'arch.modular-boundaries',
        area: 'Architecture',
        severity: 'critical',
        description: 'No cross-feature internals',
        link: '',
        examples: {},
        scope: [],
        trigger: { type: 'pattern', signals: [] },
        status: 'active',
        version: 1,
      },
      {
        id: 'style.no-todo-comment',
        area: 'DX',
        severity: 'minor',
        description: 'No TODOs inline',
        link: '',
        examples: {},
        scope: [],
        trigger: { type: 'pattern', signals: [] },
        status: 'active',
        version: 1,
      },
    ],
    ...(partial ?? {}),
  }
}

describe('@sentinel/provider-local', () => {
  it('exposes provider name', () => {
    expect(localProvider.name).toBeDefined()
    expect(localProvider.name?.toLowerCase()).toContain('local')
  })

  it('returns ReviewJson shape with version, run_id, findings[]', async () => {
    const diff = makeDiff('// TODO: fix')
    const res = await localProvider.review({
      diffText: diff,
      profile: 'any',
      rules: makeRulesJson(),
      boundaries: null,
    })

    expect(res.ai_review.version).toBe(1)
    expect(typeof res.ai_review.run_id).toBe('string')
    expect(Array.isArray(res.ai_review.findings)).toBe(true)
  })

  it('detects TODO comment via engine and maps rule meta from rules.json', async () => {
    const diff = makeDiff('// TODO: fix me please')
    const res = await localProvider.review({
      diffText: diff,
      profile: 'frontend',
      rules: makeRulesJson(),
      boundaries: null,
    })

    const f = res.ai_review.findings.find(x => x.rule === 'style.no-todo-comment')
    expect(f).toBeTruthy()
    expect(f!.area).toBe('DX')            // из rules.json
    expect(f!.severity).toBe('minor')     // из rules.json
    expect(f!.file).toBe('src/features/a/file.ts')
    expect(f!.locator).toBe('L1')
    expect(f!.finding[0]).toMatch(/TODO/i)
    expect(f!.fingerprint).toMatch(/^[a-f0-9]{40}$/)
  })

  it('flags cross-feature internal import (arch.modular-boundaries)', async () => {
    const diff = makeDiff(`import x from 'feature-b/internal/utils'`)
    const res = await localProvider.review({
      diffText: diff,
      profile: 'frontend',
      rules: makeRulesJson(),
      boundaries: null,
    })

    const f = res.ai_review.findings[0]
    expect(f.rule).toBe('arch.modular-boundaries')
    expect(f.area).toBe('Architecture')
    expect(f.severity).toBe('critical')
    expect(f.finding[0]).toMatch(/Cross-feature internal/i)
  })

  it('uses boundaries config when provided (forbidden import hit)', async () => {
    const diff = makeDiff(`import x from '../b/internal/foo'`, 'src/features/a/index.ts')
    const boundaries: BoundariesConfig = {
      forbidden: [
        {
          rule: 'feature-to-feature-internal',
          from: { glob: 'src/features/a/**' },
          to: { glob: '**/internal/**' },
          explain: 'no cross feature',
        }
      ],
    }

    const res = await localProvider.review({
      diffText: diff,
      profile: 'frontend',
      rules: makeRulesJson({
        rules: [
          {
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
          }
        ]
      }),
      boundaries,
    })

    const f = res.ai_review.findings.find(x => x.rule === 'boundaries.feature-to-feature-internal')
    expect(f).toBeTruthy()
    expect(f!.why).toBe('no cross feature')
    expect(f!.finding[0]).toMatch(/Forbidden import/i)
  })

  it('returns empty findings when diff has no violations', async () => {
    const diff = makeDiff('const ok = 42')
    const res = await localProvider.review({
      diffText: diff,
      profile: 'frontend',
      rules: makeRulesJson(),
      boundaries: null,
    })
    expect(res.ai_review.findings).toEqual([])
  })
})
