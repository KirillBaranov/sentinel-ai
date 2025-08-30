import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  ensureDirForFile,
  resolveRepoPath,
  linkifyFile,
  findRepoRoot,
  printReviewSummary,
  printContextSummary,
  printRenderSummaryMarkdown,
  printRenderSummaryHtml,
  printInitNextSteps,
  sevRank,
} from '../cli-utils'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Severity } from '@sentinel/core'

const spyLog = () => {
  const logs: string[] = []
  const orig = console.log
  vi.spyOn(console, 'log').mockImplementation((...a: any[]) => {
    logs.push(a.join(' '))
    return undefined as any
  })
  vi.spyOn(console, 'warn').mockImplementation(() => undefined as any)
  vi.spyOn(console, 'error').mockImplementation(() => undefined as any)
  return {
    get: () => logs.join('\n'),
    restore: () => {
      ;(console.log as any).mockRestore?.()
      ;(console.warn as any).mockRestore?.()
      ;(console.error as any).mockRestore?.()
    },
  }
}

describe('cli-utils', () => {
  let tmp: string
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-'))
  })
  afterEach(() => {
    vi.restoreAllMocks()
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
  })

  it('ensureDirForFile creates missing dirs', () => {
    const p = path.join(tmp, 'a/b/c/file.txt')
    ensureDirForFile(p)
    expect(fs.existsSync(path.dirname(p))).toBe(true)
  })

  it('resolveRepoPath resolves relative to repo root', () => {
    const repo = tmp
    const abs = resolveRepoPath(repo, '/etc/hosts')
    expect(abs).toBe('/etc/hosts')
    const rel = resolveRepoPath(repo, 'dist/out.md')
    expect(rel).toBe(path.join(repo, 'dist/out.md'))
  })

  it('linkifyFile returns file:// URL', () => {
    const p = path.join(tmp, 'x.txt')
    fs.writeFileSync(p, 'ok')
    expect(linkifyFile(p)).toMatch(/^file:\/\//)
  })

  it('findRepoRoot: env override', () => {
    process.env.SENTINEL_REPO_ROOT = tmp
    expect(findRepoRoot('/does/not/matter')).toBe(tmp)
    delete process.env.SENTINEL_REPO_ROOT
  })

  it('findRepoRoot: ascends until pnpm-workspace.yaml/.git', () => {
    // repo/
    //   pnpm-workspace.yaml
    //   sub/inner (start here)
    const repo = path.join(tmp, 'repo')
    const sub = path.join(repo, 'sub', 'inner')
    fs.mkdirSync(sub, { recursive: true })
    fs.writeFileSync(path.join(repo, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n')
    expect(findRepoRoot(sub)).toBe(repo)
  })

  it('findRepoRoot: fallback to start if nothing found', () => {
    const start = path.join(tmp, 'isolated')
    fs.mkdirSync(start, { recursive: true })
    expect(findRepoRoot(start)).toBe(path.resolve(start))
  })

  it('printReviewSummary: none/threshold/legacy lines are printed', () => {
    const spy = spyLog()
    const repo = tmp
    const findings = [
      { severity: 'major' as Severity },
      { severity: 'minor' as Severity },
    ]
    // none
    printReviewSummary({
      repoRoot: repo,
      providerLabel: 'local',
      profile: 'frontend',
      outJsonPath: path.join(repo, 'dist/review.json'),
      outMdPath: path.join(repo, 'dist/review.md'),
      findings,
      exit: { mode: 'none', exitCode: 0 },
    })
    // threshold
    printReviewSummary({
      repoRoot: repo,
      providerLabel: 'local',
      profile: 'frontend',
      outJsonPath: path.join(repo, 'dist/review.json'),
      outMdPath: path.join(repo, 'dist/review.md'),
      findings,
      exit: { mode: 'threshold', exitCode: 1, threshold: 'major', top: 'major' },
    })
    // legacy
    printReviewSummary({
      repoRoot: repo,
      providerLabel: 'local',
      profile: 'frontend',
      outJsonPath: path.join(repo, 'dist/review.json'),
      outMdPath: path.join(repo, 'dist/review.md'),
      findings,
      exit: { mode: 'legacy', exitCode: 10, top: 'major' },
    })

    const out = spy.get()
    spy.restore()
    expect(out).toMatch(/Review summary/)
    expect(out).toMatch(/failOn=none/)
    expect(out).toMatch(/failOn=major/)
    expect(out).toMatch(/legacy policy/)
    expect(out).toMatch(/findings: 2/)
  })

  it('printContextSummary prints sections & checksum', () => {
    const spy = spyLog()
    const repo = tmp
    printContextSummary({
      repoRoot: repo,
      profile: 'frontend',
      profilesRootLabel: 'packages/profiles',
      outFile: path.join(repo, 'dist/ai-review-context.md'),
      handbookCount: 2,
      adrCount: 1,
      hasBoundaries: true,
      bytes: 1234,
      tokens: 321,
      checksum: 'deadbeef',
    })
    const out = spy.get()
    spy.restore()
    expect(out).toMatch(/Context summary/)
    expect(out).toMatch(/handbook 2, adr 1, boundaries yes/)
    expect(out).toMatch(/checksum: deadbeef/)
  })

  it('printRenderSummaryMarkdown & Html include file links', () => {
    const spy = spyLog()
    const inFile = path.join(tmp, 'review.json')
    const outMd = path.join(tmp, 'review.md')
    const outHtml = path.join(tmp, 'review.html')
    fs.writeFileSync(inFile, '{}')

    printRenderSummaryMarkdown({
      repoRoot: tmp,
      inFile,
      outFile: outMd,
      findingsCount: 7,
    })
    printRenderSummaryHtml({
      repoRoot: tmp,
      inFile,
      outFile: outHtml,
    })

    const out = spy.get()
    spy.restore()
    expect(out).toMatch(/Render \(Markdown\) summary/)
    expect(out).toMatch(/Render \(HTML\) summary/)
    expect(out).toMatch(/findings: 7/)
    expect(out).toMatch(/file:\/\//)
  })

  it('printInitNextSteps prints dry-run command with proper paths', () => {
    const spy = spyLog()
    const repo = tmp
    const baseRoot = path.join(repo, 'packages', 'profiles')
    const root = path.join(baseRoot, 'frontend')
    fs.mkdirSync(path.join(root, 'docs', 'handbook'), { recursive: true })
    fs.mkdirSync(path.join(root, 'docs', 'rules'), { recursive: true })
    fs.writeFileSync(path.join(root, 'docs', 'rules', 'rules.json'), '{}')

    printInitNextSteps({
      repoRoot: repo,
      profile: 'frontend',
      root,
      baseRoot,
    })

    const out = spy.get()
    spy.restore()
    expect(out).toMatch(/Next steps/)
    expect(out).toMatch(/docs\/handbook/)
    expect(out).toMatch(/docs\/rules\/rules\.json/)
    expect(out).toMatch(/--profiles-dir packages\/profiles/)
    expect(out).toMatch(/--fail-on none/)
  })
})
