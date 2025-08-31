import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import { makeSandbox } from '../../__tests__/helpers/sandbox'

let renderHtmlCLI: (opts: { inFile: string; outFile: string }) => Promise<void>

describe('renderHtmlCLI (with sandbox)', () => {
  let sbx: ReturnType<typeof makeSandbox>
  let envBackup: NodeJS.ProcessEnv

  beforeEach(async () => {
    envBackup = { ...process.env }
    sbx = makeSandbox('sentinel-render-html-')

    process.env.SENTINEL_REPO_ROOT = sbx.root
    vi.resetModules()

    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const mod = await import('../render-html')
    renderHtmlCLI = mod.renderHtmlCLI
  })

  afterEach(() => {
    process.env = envBackup
    vi.clearAllMocks()
    sbx.cleanup()
  })

  function writeReviewJson(root: string, relPath = 'dist/review.json') {
    const p = path.join(root, relPath)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    const data = {
      ai_review: {
        run_id: 'run-123',
        findings: [
          {
            severity: 'critical',
            rule: 'arch.modular-boundaries',
            area: 'Architecture',
            file: 'src/app/main.ts',
            finding: ['Cross-feature import detected'],
            locator: ':1:1',
            why: 'Feature A imports internal module of Feature B',
            suggestion: 'Use shared port/adapter instead of direct import',
          },
          {
            severity: 'minor',
            rule: 'style.no-todo-comment',
            area: 'DX',
            file: 'src/shared/util.ts',
            finding: ['Found TODO in code'],
          },
        ],
      },
    }
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8')
    return p
  }

  it('renders review.json → HTML and writes output file (absolute paths)', async () => {
    const inFile = writeReviewJson(sbx.root) // /tmp/.../dist/review.json
    const outFile = path.join(sbx.root, 'dist', 'review.html')

    await renderHtmlCLI({ inFile, outFile })

    expect(fs.existsSync(outFile)).toBe(true)
    const html = fs.readFileSync(outFile, 'utf8')

    expect(html).toMatch(/<!doctype html>/i)
    expect(html).toMatch(/<html[^>]*>/i)
    expect(html).toMatch(/<\/html>/i)

    expect(html).toMatch(/<h1>Sentinel AI Review — run-123<\/h1>/)
    expect(html).toMatch(/<h2>🛑\s*Critical<\/h2>/)
    expect(html).toMatch(/<h2>💡\s*Minor<\/h2>/)

    expect(html).toMatch(/<li>.*arch\.modular-boundaries.*<\/li>/s)
    expect(html).toMatch(/<li>.*style\.no-todo-comment.*<\/li>/s)

    expect(html).toMatch(/<code>src\/app\/main\.ts<\/code>/)
    expect(html).toMatch(/<code>src\/shared\/util\.ts<\/code>/)
  })

  it('creates parent directories for outFile if missing', async () => {
    const inFile = writeReviewJson(sbx.root)
    const outFile = path.join(sbx.root, 'nested', 'reports', 'review.html')

    await renderHtmlCLI({ inFile, outFile })

    expect(fs.existsSync(outFile)).toBe(true)
    const html = fs.readFileSync(outFile, 'utf8')
    expect(html).toMatch(/Sentinel AI Review — run-123/)
  })

  it('supports resolving relative paths against SENTINEL_REPO_ROOT', async () => {
    const relIn = 'dist/review.json'
    const relOut = 'dist/review.html'
    writeReviewJson(sbx.root, relIn)

    await renderHtmlCLI({ inFile: relIn, outFile: relOut })

    const outAbs = path.join(sbx.root, relOut)
    expect(fs.existsSync(outAbs)).toBe(true)
    const html = fs.readFileSync(outAbs, 'utf8')
    expect(html).toMatch(/<h1>Sentinel AI Review — run-123<\/h1>/)
  })
})
