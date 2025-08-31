import { describe, it, expect } from 'vitest'
import { mockProvider } from '../index'

function makeDiff(text: string, file = 'src/file.ts') {
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    '@@ -1,0 +1,1 @@',
    `+${text}`,
    ''
  ].join('\n')
}

describe('@sentinel/provider-mock', () => {
  it('exposes provider name', () => {
    expect(mockProvider.name).toBeDefined()
    expect(mockProvider.name?.toLowerCase()).toContain('mock')
  })

  it('returns ReviewJson shape with version, run_id, findings[]', async () => {
    const diff = makeDiff('// anything')
    const res = await mockProvider.review({ diffText: diff, profile: 'x', rules: null, boundaries: null })
    expect(res.ai_review.version).toBe(1)
    expect(typeof res.ai_review.run_id).toBe('string')
    expect(Array.isArray(res.ai_review.findings)).toBe(true)
  })

  it('is deterministic for the same diff/profile input (fingerprints stable)', async () => {
    const diff = makeDiff('// hello')
    const a = await mockProvider.review({ diffText: diff, profile: 'p1', rules: null, boundaries: null })
    const b = await mockProvider.review({ diffText: diff, profile: 'p1', rules: null, boundaries: null })
    const fa = a.ai_review.findings.map(f => f.fingerprint).join('|')
    const fb = b.ai_review.findings.map(f => f.fingerprint).join('|')
    expect(fa).toBe(fb)
  })

  it('reflects input file name in findings file field (if provider mocks by diff parsing)', async () => {
    const diff = makeDiff('// hey', 'src/foo/bar.ts')
    const res = await mockProvider.review({ diffText: diff, profile: 'p', rules: null, boundaries: null })
    for (const f of res.ai_review.findings) {
      expect(typeof f.file).toBe('string')
      expect(f.file.length).toBeGreaterThan(0)
    }
  })
})
