import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHtmlCLI } from '../render-html'

describe('render-html', () => {
  let tmp: string
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-')) })
  afterEach(() => { try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {} })

  it('renderHtmlCLI converts JSON to HTML report', async () => {
    const inFile = path.join(tmp, 'review.json')
    const outFile = path.join(tmp, 'report.html')
    const data: any = {
      ai_review: {
        run_id: 'run-1',
        findings: [{ severity: 'major', area: 'DX', rule: 'no-todo', file: 'src/a.ts', finding: ['todo'] }],
      },
    }
    fs.writeFileSync(inFile, JSON.stringify(data, null, 2))
    await renderHtmlCLI({ inFile, outFile })
    const html = fs.readFileSync(outFile, 'utf8')
    expect(html).toMatch(/<!doctype html>/i)
    expect(html).toMatch(/<h1>Sentinel AI Review/)
    expect(html).toMatch(/<ul>/)
    expect(html).toMatch(/<code>/) // inline code support
  })
})
