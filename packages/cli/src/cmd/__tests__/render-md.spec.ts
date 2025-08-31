
import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import { makeSandbox } from '../../__tests__/helpers/sandbox'

let renderMdCLI: (opts: { inFile: string; outFile: string }) => Promise<void>
let renderMarkdownFromJson: (json: any) => string

describe('render-md (with sandbox)', () => {
  let sbx: ReturnType<typeof makeSandbox>
  let envBackup: NodeJS.ProcessEnv

  beforeEach(async () => {
    envBackup = { ...process.env }
    sbx = makeSandbox('sentinel-render-md-')

    process.env.SENTINEL_REPO_ROOT = sbx.root
    vi.resetModules()

    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const mod = await import('../render-md')
    renderMdCLI = mod.renderMdCLI
    renderMarkdownFromJson = mod.renderMarkdownFromJson
  })

  afterEach(() => {
    process.env = envBackup
    vi.clearAllMocks()
    sbx.cleanup()
  })

  function writeReviewJson(root: string, relPath = 'dist/review.json', payload?: any) {
    const p = path.join(root, relPath)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    const data =
      payload ??
      {
        ai_review: {
          run_id: 'run-42',
          findings: [
            {
              severity: 'critical',
              rule: 'arch.modular-boundaries',
              area: 'Architecture',
              file: 'src/app/main.ts',
              locator: ':1:1',
              finding: ['Cross-feature import detected'],
              why: 'Feature A imports B/internal',
              suggestion: 'Use shared port',
            },
            {
              severity: 'minor',
              rule: 'style.no-todo-comment',
              area: 'DX',
              file: 'src/shared/util.ts',
              finding: ['Found TODO'],
            },
          ],
        },
      }
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8')
    return p
  }

  // ────────────────────────────────────────────────────────────────────────────
  // unit: renderMarkdownFromJson
  // ────────────────────────────────────────────────────────────────────────────

  it('renderMarkdownFromJson: makes title, sections by severity and list items', () => {
    const md = renderMarkdownFromJson({
      ai_review: {
        run_id: 'run-777',
        findings: [
          {
            severity: 'critical',
            rule: 'r1',
            area: 'Architecture',
            file: 'a.ts',
            locator: ':10:2',
            finding: ['bad thing'],
          },
          {
            severity: 'minor',
            rule: 'r2',
            area: 'DX',
            file: 'b.ts',
            finding: ['small issue'],
          },
        ],
      },
    })

    expect(md).toMatch(/^# Sentinel AI Review — run-777/m)
    expect(md).toMatch(/## 🛑 Critical/)
    expect(md).toMatch(/## 💡 Minor/)

    expect(md).toMatch(/\*\*r1\*\* in `a\.ts` :10:2/)
    expect(md).toMatch(/\*\*r2\*\* in `b\.ts`/)

    expect(md).toMatch(/---\nFeedback: .+Relevant.+Noisy/)
  })

  it('renderMarkdownFromJson: groups by area and sorts them alphabetically', () => {
    const md = renderMarkdownFromJson({
      ai_review: {
        run_id: 'run',
        findings: [
          { severity: 'major', rule: 'rA', area: 'DX', file: 'x.ts', finding: [] },
          { severity: 'major', rule: 'rB', area: 'Architecture', file: 'y.ts', finding: [] },
        ],
      },
    })

    const archIdx = md.indexOf('- **Architecture**')
    const dxIdx = md.indexOf('- **DX**')
    expect(archIdx).toBeGreaterThan(0)
    expect(dxIdx).toBeGreaterThan(0)
    expect(archIdx).toBeLessThan(dxIdx)
  })

  it('renderMarkdownFromJson: unknown severity falls back to Minor', () => {
    const md = renderMarkdownFromJson({
      ai_review: {
        run_id: 'run',
        findings: [{ severity: 'weird', rule: 'rX', file: 'x.ts', finding: [] }],
      },
    } as any)

    const minorSection = md.match(/## 💡 Minor[\s\S]*?(?=##|---)/)
    expect(minorSection?.[0] || '').toMatch(/rX/)
  })

  it('renderMarkdownFromJson: empty sections show "No issues found"', () => {
    const md = renderMarkdownFromJson({
      ai_review: { run_id: 'run', findings: [{ severity: 'info', rule: 'r', file: 'a', finding: [] }] },
    })
    expect(md).toMatch(/## 🛑 Critical[\s\S]*No issues found/)
    expect(md).toMatch(/## ⚠️ Major[\s\S]*No issues found/)
  })

  // ────────────────────────────────────────────────────────────────────────────
  // integration: renderMdCLI
  // ────────────────────────────────────────────────────────────────────────────

  it('renderMdCLI: writes Markdown and creates missing directories (absolute paths)', async () => {
    const inFile = writeReviewJson(sbx.root)
    const outFile = path.join(sbx.root, 'reports', 'pretty.md')

    await renderMdCLI({ inFile, outFile })

    expect(fs.existsSync(outFile)).toBe(true)
    const md = fs.readFileSync(outFile, 'utf8')
    expect(md).toMatch(/^# Sentinel AI Review — run-42/m)
    expect(md).toMatch(/## 🛑 Critical/)
    expect(md).toMatch(/## 💡 Minor/)
  })

  it('renderMdCLI: supports relative paths relative to SENTINEL_REPO_ROOT', async () => {
    const relIn = 'dist/review.json'
    const relOut = 'dist/review.md'
    writeReviewJson(sbx.root, relIn)

    await renderMdCLI({ inFile: relIn, outFile: relOut })

    const outAbs = path.join(sbx.root, relOut)
    expect(fs.existsSync(outAbs)).toBe(true)
    const md = fs.readFileSync(outAbs, 'utf8')
    expect(md).toMatch(/Sentinel AI Review — run-42/)
  })
})
