import { describe, it, expect } from 'vitest'
import {
  toPosix,
  extractImportSpecifier,
  violatesRule,
  checkForbidden,
  type BoundariesConfig,
  type BoundaryRule,
  type ImportEdge,
} from '../boundaries'

describe('toPosix', () => {
  it('replaces platform-specific separators with "/"', () => {
    // emulate windows path
    const win = 'src\\features\\a\\x.ts'
    expect(toPosix(win)).toBe('src/features/a/x.ts')

    const alreadyPosix = 'src/features/a/x.ts'
    expect(toPosix(alreadyPosix)).toBe('src/features/a/x.ts')
  })
})

describe('extractImportSpecifier', () => {
  it('parses specifier from "import ... from"', () => {
    expect(extractImportSpecifier(`import x from 'lib/a'`)).toBe('lib/a')
    expect(extractImportSpecifier(`import { a, b } from "pkg/sub"`)).toBe('pkg/sub')
  })

  it('parses specifier from bare "import" form', () => {
    expect(extractImportSpecifier(`import 'polyfill/shim'`)).toBe('polyfill/shim')
    expect(extractImportSpecifier(`import  "foo"`)).toBe('foo')
  })

  it('parses specifier from "export * from"', () => {
    expect(extractImportSpecifier(`export * from './local'`)).toBe('./local')
  })

  it('returns null for non-ESM patterns', () => {
    expect(extractImportSpecifier(`const x = require('legacy')`)).toBeNull()
    expect(extractImportSpecifier(`// import "commented"`)).toBeNull()
    expect(extractImportSpecifier(`console.log('no import here')`)).toBeNull()
  })
})

describe('violatesRule', () => {
  const make = (edge: Partial<ImportEdge>): ImportEdge => ({
    fromFile: 'src/features/a/x.ts',
    specifier: 'src/features/b/internal/z.ts',
    ...edge,
  })

  const baseRule: BoundaryRule = {
    rule: 'feature-to-feature-internal',
    from: { glob: 'src/features/*/**' },
    to: { glob: 'src/features/*/internal/**' },
    allowVia: ['src/shared/ports/**'],
    explain: 'no direct access to other feature internal',
  }

  it('returns false when "from" does not match', () => {
    const edge = make({ fromFile: 'src/shared/util.ts' })
    expect(violatesRule(edge, baseRule)).toBe(false)
  })

  it('returns true when from matches and to matches', () => {
    const edge = make()
    expect(violatesRule(edge, baseRule)).toBe(true)
  })

  it('returns false when import goes through allowed adapter (allowVia)', () => {
    const edge = make({ specifier: 'src/shared/ports/b-adapter.ts' })
    expect(violatesRule(edge, baseRule)).toBe(false)
  })

  it('treats specifier as-is (no resolution) and supports globbing', () => {
    const edge = make({ specifier: 'src/features/c/internal/deep/nested.ts' })
    expect(violatesRule(edge, baseRule)).toBe(true)

    const edgeOk = make({ specifier: 'src/shared/ports/c-adapter/index.ts' })
    expect(violatesRule(edgeOk, baseRule)).toBe(false)
  })
})

describe('checkForbidden', () => {
  const rules: BoundaryRule[] = [
    {
      rule: 'rule-1',
      from: { glob: 'src/app/**' },
      to: { glob: 'src/shared/internal/**' },
    },
    {
      rule: 'rule-2',
      from: { glob: 'src/features/*/**' },
      to: { glob: 'src/features/*/internal/**' },
      allowVia: ['src/shared/ports/**'],
    },
  ]
  const cfg: BoundariesConfig = { forbidden: rules }

  it('collects all violated rules for the edge', () => {
    const edge: ImportEdge = {
      fromFile: 'src/features/payments/x.ts',
      specifier: 'src/features/users/internal/db.ts',
    }
    const hit = checkForbidden(edge, cfg).map(r => r.rule)
    expect(hit).toEqual(['rule-2'])
  })

  it('returns empty array when no rules are violated', () => {
    const edge: ImportEdge = {
      fromFile: 'src/app/main.ts',
      specifier: 'src/shared/api/index.ts',
    }
    expect(checkForbidden(edge, cfg)).toEqual([])
  })

  it('respects allowVia and suppresses violation', () => {
    const edge: ImportEdge = {
      fromFile: 'src/features/orders/x.ts',
      specifier: 'src/shared/ports/users-adapter.ts',
    }
    const hit = checkForbidden(edge, cfg)
    expect(hit).toEqual([])
  })

  it('handles empty forbidden list gracefully', () => {
    const emptyCfg: BoundariesConfig = { forbidden: [] }
    const edge: ImportEdge = {
      fromFile: 'src/features/a/x.ts',
      specifier: 'src/features/b/internal/y.ts',
    }
    expect(checkForbidden(edge, emptyCfg)).toEqual([])
  })
})
