import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderMarkdownFromJson, renderMdCLI } from '../render-md'

describe('render-md', () => {
  let tmp: string
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-')) })
  afterEach(() => { try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {} })

  it('renderMarkdownFromJson groups by severity and area', async () => {
    const json: any = {
      ai_review: {
        run_id: 'run-42',
        findings: [
          { severity: 'major', area: 'DX', rule: 'no-todo', file: 'src/a.ts', finding: ['todo found'] },
          { severity: 'critical', area: 'Architecture', rule: 'boundaries', file: 'src/b.ts' },
          { severity: 'info', rule: 'note', file: 'src/c.ts' },
        ],
      },
    }
    const md = renderMarkdownFromJson(json)
    expect(md).toMatch(/Sentinel AI Review — run-42/)
    expect(md).toMatch(/## 🛑 Critical/)
    expect(md).toMatch(/## ⚠️ Major/)
    expect(md).toMatch(/## 🛈 Info/)
    expect(md).toMatch(/DX/)
    expect(md).toMatch(/Architecture/)
  })

  it('renderMdCLI writes file and prints summary', async () => {
    const inFile = path.join(tmp, 'review.json')
    const outFile = path.join(tmp, 'out.md')
    const data: any = {
      ai_review: { run_id: 'run', findings: [{ severity: 'minor', rule: 'x', file: 'f.ts' }] },
    }
    fs.writeFileSync(inFile, JSON.stringify(data, null, 2))
    await renderMdCLI({ inFile, outFile })
    const md = fs.readFileSync(outFile, 'utf8')
    expect(md).toMatch(/Sentinel AI Review/)
    expect(md).toMatch(/Minor/)
  })
})
