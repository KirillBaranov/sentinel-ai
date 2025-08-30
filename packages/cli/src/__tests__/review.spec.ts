import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'

type Finding = { severity: 'critical'|'major'|'minor'|'info', rule: string, file: string, finding: string[] }
const makeReview = (findings: Finding[]) => ({ ai_review: { run_id: 'test-run', findings } })

const { reviewMock } = vi.hoisted(() => {
  return {
    reviewMock: vi.fn(async (_args: any) => makeReview([
      { severity: 'major', rule: 'r1', file: 'a.ts', finding: ['x'] },
      { severity: 'minor', rule: 'r2', file: 'b.ts', finding: ['y'] },
      { severity: 'info',  rule: 'r3', file: 'c.ts', finding: ['z'] },
    ])),
  }
})

vi.mock('@sentinel/provider-mock', () => ({
  mockProvider: { review: reviewMock, name: 'mock' },
}))
vi.mock('@sentinel/provider-local', () => ({
  localProvider: { review: reviewMock, name: 'local' },
}))

import { runReviewCLI } from '../review'

function makeProfileTree(repoRoot: string, profile = 'frontend') {
  const profilesDir = path.join(repoRoot, 'packages', 'profiles')
  const pRoot = path.join(profilesDir, profile)
  const hb = path.join(pRoot, 'docs', 'handbook')
  const rules = path.join(pRoot, 'docs', 'rules')

  fs.mkdirSync(hb, { recursive: true })
  fs.mkdirSync(rules, { recursive: true })
  fs.writeFileSync(path.join(hb, 'architecture.md'), '# Arch\n')
  fs.writeFileSync(path.join(rules, 'rules.json'), JSON.stringify({
    version: 1, domain: profile, rules: [{ id: 'r1', severity: 'major' }]
  }, null, 2))
  fs.writeFileSync(path.join(rules, 'boundaries.json'), JSON.stringify({ layers: [], forbidden: [] }, null, 2))
  return { profilesDir, pRoot }
}

describe('runReviewCLI', () => {
  let tmp: string
  let exitSpy: any
  let envBackup: NodeJS.ProcessEnv

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-review-'))
    envBackup = { ...process.env }
    process.env.SENTINEL_REPO_ROOT = tmp

    fs.mkdirSync(path.join(tmp, 'dist'), { recursive: true })
    fs.mkdirSync(path.join(tmp, 'fixtures'), { recursive: true })
    fs.writeFileSync(path.join(tmp, 'fixtures', 'changes.diff'), 'diff --git a/a.ts b/a.ts\n')

    makeProfileTree(tmp, 'frontend')

    reviewMock.mockClear()

    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: any) => {
      throw new Error(`__exit__:${code ?? 0}`)
    }) as any)
  })

  afterEach(() => {
    vi.clearAllMocks()
    process.env = envBackup
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
  })

  it('writes review.json and review.md and exits 0 with failOn=none', async () => {
    const outJson = path.join(tmp, 'dist', 'review.json')
    const outMd   = path.join(tmp, 'dist', 'review.md')

    try {
      await runReviewCLI({
        diff: 'fixtures/changes.diff',
        profile: 'frontend',
        profilesDir: 'packages/profiles',
        provider: 'mock',
        outJson: outJson,
        outMd: outMd,
        failOn: 'none',
      } as any)
    } catch (e: any) {
      expect(String(e.message)).toMatch(/__exit__:0/)
    }

    expect(fs.existsSync(outJson)).toBe(true)
    const json = JSON.parse(fs.readFileSync(outJson, 'utf8')) as any
    expect(json?.ai_review?.findings?.length).toBe(3)

    expect(fs.existsSync(outMd)).toBe(true)
    const md = fs.readFileSync(outMd, 'utf8')
    expect(md).toMatch(/<!-- SENTINEL:DUAL:JSON -->/)
    expect(md).toMatch(/```json/)
  })

  it('caps findings by maxComments (перезаписываем ответ провайдера на 1 вызов)', async () => {
    reviewMock.mockResolvedValueOnce(makeReview([
      { severity: 'major', rule: 'r1', file: 'a.ts', finding: ['1'] },
      { severity: 'major', rule: 'r2', file: 'a.ts', finding: ['2'] },
      { severity: 'minor', rule: 'r3', file: 'a.ts', finding: ['3'] },
      { severity: 'info',  rule: 'r4', file: 'a.ts', finding: ['4'] },
    ] as any))

    const outJson = path.join(tmp, 'dist', 'review.json')

    try {
      await runReviewCLI({
        diff: 'fixtures/changes.diff',
        profile: 'frontend',
        profilesDir: 'packages/profiles',
        provider: 'mock',
        outJson,
        outMd: path.join(tmp, 'dist', 'review.md'),
        maxComments: 2,
        failOn: 'none',
      } as any)
    } catch (e: any) {
      expect(String(e.message)).toMatch(/__exit__:0/)
    }

    const json = JSON.parse(fs.readFileSync(outJson, 'utf8')) as any
    expect(json.ai_review.findings.length).toBe(2)
  })

  it('exits 1 when failOn=major and top severity is major', async () => {
    try {
      await runReviewCLI({
        diff: 'fixtures/changes.diff',
        profile: 'frontend',
        profilesDir: 'packages/profiles',
        provider: 'mock',
        outJson: path.join(tmp, 'dist', 'review.json'),
        outMd: path.join(tmp, 'dist', 'review.md'),
        failOn: 'major',
      } as any)
    } catch (e: any) {
      expect(String(e.message)).toMatch(/__exit__:1/)
    }
  })

  it('exits 0 when failOn=critical and top severity is major', async () => {
    try {
      await runReviewCLI({
        diff: 'fixtures/changes.diff',
        profile: 'frontend',
        profilesDir: 'packages/profiles',
        provider: 'mock',
        outJson: path.join(tmp, 'dist', 'review.json'),
        outMd: path.join(tmp, 'dist', 'review.md'),
        failOn: 'critical',
      } as any)
    } catch (e: any) {
      expect(String(e.message)).toMatch(/__exit__:0/)
    }
  })

  it('throws a clear error if diff file is missing', async () => {
    await expect(runReviewCLI({
      diff: 'fixtures/missing.diff',
      profile: 'frontend',
      profilesDir: 'packages/profiles',
      provider: 'mock',
      outJson: path.join(tmp, 'dist', 'review.json'),
      outMd: path.join(tmp, 'dist', 'review.md'),
      failOn: 'none',
    } as any)).rejects.toThrow(/diff file not found/)
  })
})
