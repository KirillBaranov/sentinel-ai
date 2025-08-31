// packages/core/src/lib/__tests__/diff.spec.ts
import { describe, it, expect } from 'vitest'
import { parseUnifiedDiff, hunkLocator } from '../diff'

describe('parseUnifiedDiff', () => {
  it('parses single file with one hunk and added lines', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 0000000..1111111 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,3 +1,4 @@',
      ' import x from "y"',
      '+const a = 1',
      ' console.log(x)',
      '-const old = true',
      '',
    ].join('\n')

    const files = parseUnifiedDiff(diff)
    expect(files.length).toBe(1)

    const f = files[0]
    expect(f.filePath).toBe('src/a.ts')
    expect(f.hunks.length).toBe(1)

    const h = f.hunks[0]
    expect(h.header).toContain('@@ -1,3 +1,4 @@')
    // added lines should be captured with NEW file line numbers
    expect(h.added).toEqual([
      { line: 2, text: 'const a = 1' }, // newStart=1, context line advances to 1, then added → 2
    ])
  })

  it('tracks cursor over context/removed/added lines across multiple hunks', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 0000000..1111111 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,3 +1,4 @@',
      ' import x from "y"',   // context (advance new → 1)
      '+const a = 1',        // added   (advance new → 2)  → capture line 2
      ' console.log(x)',     // context (advance new → 3)
      '-const old = true',   // removed (no advance on new side)',
      '@@ -10,1 +10,2 @@',
      '-  return 1',         // removed (no advance)',
      '+  const z = 2',      // added   (10 → 10)         → capture line 10',
      '+  return z',         // added   (advance new → 11)→ capture line 11',
      '',
    ].join('\n')

    const [file] = parseUnifiedDiff(diff)
    expect(file.filePath).toBe('src/a.ts')
    expect(file.hunks.length).toBe(2)

    expect(file.hunks[0].added).toEqual([{ line: 2, text: 'const a = 1' }])
    expect(file.hunks[1].added).toEqual([
      { line: 10, text: '  const z = 2' },
      { line: 11, text: '  return z' },
    ])
  })

  it('parses multiple files', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 000..111 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,0 +1,1 @@',
      '+const a = 1',
      'diff --git a/src/b.ts b/src/b.ts',
      'index 222..333 100644',
      '--- a/src/b.ts',
      '+++ b/src/b.ts',
      '@@ -5,2 +5,3 @@',
      ' console.log("b")',
      '+const b = 2',
      '',
    ].join('\n')

    const files = parseUnifiedDiff(diff)
    expect(files.map(f => f.filePath)).toEqual(['src/a.ts', 'src/b.ts'])
    expect(files[0].hunks[0].added).toEqual([{ line: 1, text: 'const a = 1' }])
    expect(files[1].hunks[0].added).toEqual([{ line: 6, text: 'const b = 2' }])
  })

  it('supports hunk headers without lengths (e.g. "@@ -5 +6 @@")', () => {
    const diff = [
      'diff --git a/src/c.ts b/src/c.ts',
      '--- a/src/c.ts',
      '+++ b/src/c.ts',
      '@@ -5 +6 @@',
      '+added',
      '',
    ].join('\n')

    const [file] = parseUnifiedDiff(diff)
    expect(file.filePath).toBe('src/c.ts')
    expect(file.hunks.length).toBe(1)

    const h = file.hunks[0]
    // lengths should default to 0 per implementation
    expect({ oldStart: h.oldStart, oldLines: h.oldLines, newStart: h.newStart, newLines: h.newLines })
      .toEqual({ oldStart: 5, oldLines: 0, newStart: 6, newLines: 0 })
    expect(h.added).toEqual([{ line: 6, text: 'added' }])
  })

  it('handles CRLF line endings', () => {
    const crlf = [
      'diff --git a/src/crlf.ts b/src/crlf.ts',
      '--- a/src/crlf.ts',
      '+++ b/src/crlf.ts',
      '@@ -1,0 +1,2 @@',
      '+line1',
      '+line2',
      '',
    ].join('\r\n')

    const [file] = parseUnifiedDiff(crlf)
    expect(file.filePath).toBe('src/crlf.ts')
    expect(file.hunks[0].added).toEqual([
      { line: 1, text: 'line1' },
      { line: 2, text: 'line2' },
    ])
  })

  it('ignores metadata until +++ b/<path> is seen', () => {
    const diff = [
      '*** arbitrary header ***',
      '--- a/whatever',
      '+++ b/real/file.ts',
      '@@ -1,0 +1,1 @@',
      '+x',
      '',
    ].join('\n')

    const [file] = parseUnifiedDiff(diff)
    expect(file.filePath).toBe('real/file.ts')
    expect(file.hunks[0].added).toEqual([{ line: 1, text: 'x' }])
  })
})

describe('hunkLocator', () => {
  it('produces stable locator string', () => {
    const h = {
      oldStart: 10,
      oldLines: 7,
      newStart: 12,
      newLines: 9,
      header: '@@ -10,7 +12,9 @@',
      added: [],
    }
    expect(hunkLocator(h)).toBe('HUNK:@@ -10,7 +12,9 @@')
  })
})
