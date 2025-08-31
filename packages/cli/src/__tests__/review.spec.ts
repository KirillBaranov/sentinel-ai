import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'

import { makeSandbox, makeProfile } from './helpers/sandbox'

type Finding = { severity: 'critical'|'major'|'minor'|'info', rule: string, file: string, finding: string[], why?: string, suggestion?: string }
const makeReview = (findings: Finding[]) => ({ ai_review: { run_id: 'test-run', findings } })

vi.mock('@sentinel/provider-mock', () => ({
  mockProvider: {
    name: 'mock',
    review: vi.fn(async (_args: any) => makeReview([
      { severity: 'major', rule: 'r1', file: 'a.ts', finding: ['x'] },
      { severity: 'minor', rule: 'r2', file: 'b.ts', finding: ['y'] },
      { severity: 'info',  rule: 'r3', file: 'c.ts', finding: ['z'] },
    ])),
  }
}))

vi.mock('@sentinel/provider-local', () => ({
  localProvider: {
    name: 'local',
    review: vi.fn(async (_args: any) => makeReview([
      { severity: 'major', rule: 'r1', file: 'a.ts', finding: ['x'] },
      { severity: 'minor', rule: 'r2', file: 'b.ts', finding: ['y'] },
      { severity: 'info',  rule: 'r3', file: 'c.ts', finding: ['z'] },
    ])),
  }
}))

import { runReviewCLI } from '../review'

const outJsonAt = (root: string) => path.join(root, 'dist', 'review.json')
const outMdAt   = (root: string) => path.join(root, 'dist', 'review.md')

describe('runReviewCLI (with sandbox)', () => {
  let sbx: ReturnType<typeof makeSandbox>
  let exitSpy: ReturnType<typeof vi.spyOn>
  let envBackup: NodeJS.ProcessEnv

  beforeEach(() => {
    sbx = makeSandbox('sentinel-review-')
    makeProfile(sbx.root, 'frontend')
    envBackup = { ...process.env }

    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: any) => {
      throw new Error(`__exit__:${code ?? 0}`)
    }) as any)
  })

  afterEach(() => {
    vi.clearAllMocks()
    process.env = envBackup
    sbx.cleanup()
  })

  it('writes review.json and review.md and exits 0 with failOn=none', async () => {
    const outJson = outJsonAt(sbx.root)
    const outMd   = outMdAt(sbx.root)

    await expect(runReviewCLI({
      diff: 'fixtures/changes.diff',
      profile: 'frontend',
      profilesDir: 'packages/profiles',
      provider: 'mock',
      outJson,
      outMd,
      failOn: 'none',
    } as any)).rejects.toThrow(/__exit__:0/)

    expect(fs.existsSync(outJson)).toBe(true)
    expect(fs.existsSync(outMd)).toBe(true)

    const json = JSON.parse(fs.readFileSync(outJson, 'utf8'))
    expect(json?.ai_review?.findings?.length).toBe(3)

    const md = fs.readFileSync(outMd, 'utf8')
    expect(md).toMatch(/<!-- SENTINEL:DUAL:JSON -->/)
    expect(md).toMatch(/```json/)
  })

  it('caps findings by SENTINEL_MAX_COMMENTS when set', async () => {
    process.env.SENTINEL_MAX_COMMENTS = '2'

    const outJson = outJsonAt(sbx.root)

    await expect(runReviewCLI({
      diff: 'fixtures/changes.diff',
      profile: 'frontend',
      profilesDir: 'packages/profiles',
      provider: 'mock',
      outJson,
      outMd: outMdAt(sbx.root),
      failOn: 'none',
    } as any)).rejects.toThrow(/__exit__:0/)

    const json = JSON.parse(fs.readFileSync(outJson, 'utf8'))
    expect(json.ai_review.findings.length).toBe(2)
  })

  it('exits 1 when failOn=major and top severity is major', async () => {
    await expect(runReviewCLI({
      diff: 'fixtures/changes.diff',
      profile: 'frontend',
      profilesDir: 'packages/profiles',
      provider: 'mock',
      outJson: outJsonAt(sbx.root),
      outMd: outMdAt(sbx.root),
      failOn: 'major',
    } as any)).rejects.toThrow(/__exit__:1/)
  })

  it('exits 0 when failOn=critical and top severity is major', async () => {
    await expect(runReviewCLI({
      diff: 'fixtures/changes.diff',
      profile: 'frontend',
      profilesDir: 'packages/profiles',
      provider: 'mock',
      outJson: outJsonAt(sbx.root),
      outMd: outMdAt(sbx.root),
      failOn: 'critical',
    } as any)).rejects.toThrow(/__exit__:0/)
  })

  it('throws a clear error if diff file is missing (repo-root relative resolution)', async () => {
    await expect(runReviewCLI({
      diff: 'fixtures/missing.diff',
      profile: 'frontend',
      profilesDir: 'packages/profiles',
      provider: 'mock',
      outJson: outJsonAt(sbx.root),
      outMd: outMdAt(sbx.root),
      failOn: 'none',
    } as any)).rejects.toThrow(/diff file not found/)
  })
})
