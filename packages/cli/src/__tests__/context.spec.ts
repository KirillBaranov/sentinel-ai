import fs from 'node:fs'
import path from 'node:path'
import { describe, it, beforeEach, afterEach, expect } from 'vitest'

import { makeSandbox, makeProfile } from './helpers/sandbox'
import { buildContext } from '../context'

const outPathAt = (root: string) => path.join(root, 'dist', 'ai-review-context.md')
const read = (p: string) => fs.readFileSync(p, 'utf8')
const norm = (s: string) => s.replaceAll('\\', '/')

describe('buildContext (with sandbox)', () => {
  let sbx: ReturnType<typeof makeSandbox>
  let envBackup: NodeJS.ProcessEnv

  beforeEach(() => {
    envBackup = { ...process.env }
    sbx = makeSandbox('sentinel-context-')
    makeProfile(sbx.root, 'frontend')

    process.env.SENTINEL_REPO_ROOT = sbx.root
    delete process.env.SENTINEL_PROFILES_DIR
    delete process.env.SENTINEL_CONTEXT_MAX_TOKENS
    delete process.env.SENTINEL_CONTEXT_MAX_BYTES
  })

  afterEach(() => {
    process.env = envBackup
    sbx.cleanup()
  })

  it('builds context markdown with sections (handbook, rules, boundaries)', () => {
    const res = buildContext({
      profile: 'frontend',
      repoRoot: sbx.root,
      profilesDir: 'packages/profiles',
      outFile: outPathAt(sbx.root),
      includeADR: false,
    })

    expect(fs.existsSync(res.outFile)).toBe(true)
    const md = norm(read(res.outFile))

    expect(md).toMatch(/<!-- SENTINEL:SECTION:SUMMARY -->/)
    expect(md).toMatch(/<!-- SENTINEL:SECTION:HANDBOOK -->/)
    expect(md).toMatch(/<!-- SENTINEL:SECTION:RULES -->/)
    expect(md).not.toMatch(/<!-- SENTINEL:SECTION:ADR -->/)

    expect(md).toMatch(/^# Handbook/m)
    expect(md).toMatch(/^# Rules/m)

    expect(md).toMatch(/```json\s*{\s*"version":\s*1[\s\S]*?```/)

    expect(md).toMatch(/### Handbook TOC/)
    expect(md).toMatch(/- frontend\/docs\/handbook\/architecture\.md/)
  })

  it('resolves custom profilesDir (absolute) and includes ADR when present', () => {
    const customProfiles = path.join(sbx.root, 'custom-profiles')
    const profileRoot = path.join(customProfiles, 'frontend')
    fs.mkdirSync(path.join(profileRoot, 'docs', 'handbook'), { recursive: true })
    fs.mkdirSync(path.join(profileRoot, 'docs', 'rules'), { recursive: true })
    fs.writeFileSync(path.join(profileRoot, 'docs', 'handbook', 'intro.md'), '# Intro\n', 'utf8')
    fs.writeFileSync(
      path.join(profileRoot, 'docs', 'rules', 'rules.json'),
      JSON.stringify({ version: 1, domain: 'frontend', rules: [] }, null, 2),
      'utf8'
    )
    fs.mkdirSync(path.join(profileRoot, 'docs', 'adr'), { recursive: true })
    fs.writeFileSync(path.join(profileRoot, 'docs', 'adr', '0001.md'), '# ADR 0001\nBody\n', 'utf8')

    const res = buildContext({
      profile: 'frontend',
      repoRoot: sbx.root,
      profilesDir: customProfiles,
      outFile: outPathAt(sbx.root),
      includeADR: true,
    })

    const md = norm(read(res.outFile))
    expect(md).toMatch(/<!-- SENTINEL:SECTION:ADR -->/)
    expect(md).toMatch(/# ADR 0001/)
    expect(md).toMatch(/### ADR TOC/)
    expect(md).toMatch(/- frontend\/docs\/adr\/0001\.md/)
  })

  it('trims ADR section when maxApproxTokens is too small (soft guardrail)', () => {
    const adrDir = path.join(sbx.root, 'packages', 'profiles', 'frontend', 'docs', 'adr')
    fs.mkdirSync(adrDir, { recursive: true })
    fs.writeFileSync(path.join(adrDir, '0001.md'), '# ADR 0001\nSome text\nMore text\n', 'utf8')

    const res = buildContext({
      profile: 'frontend',
      repoRoot: sbx.root,
      profilesDir: 'packages/profiles',
      outFile: outPathAt(sbx.root),
      includeADR: true,
      maxApproxTokens: 1,
    })

    const md = norm(read(res.outFile))
    expect(md).toMatch(/<!-- SENTINEL:SECTION:ADR -->/)
    expect(md).toMatch(/\*Omitted due to context size constraints\.\*/)
  })

  it('throws a clear error when rules.json is missing', () => {
    const rulesPath = path.join(
      sbx.root,
      'packages',
      'profiles',
      'frontend',
      'docs',
      'rules',
      'rules.json'
    )
    fs.rmSync(rulesPath, { force: true })

    expect(fs.existsSync(rulesPath)).toBe(false)

    expect(() =>
      buildContext({
        profile: 'frontend',
        repoRoot: sbx.root,
        profilesDir: 'packages/profiles',
        outFile: outPathAt(sbx.root),
      })
    ).toThrow(/rules\.json not found/)
  })

  it('writes footer checksums and returns metadata (bytes, tokens, hashes)', () => {
    const res = buildContext({
      profile: 'frontend',
      repoRoot: sbx.root,
      profilesDir: 'packages/profiles',
      outFile: outPathAt(sbx.root),
    })
    const md = norm(read(res.outFile))

    expect(md).toMatch(/## Checksums/)
    expect(md).toMatch(/"baseHash":/)
    expect(md).toMatch(/"finalHash":/)

    expect(res.bytes).toBeGreaterThan(0)
    expect(res.approxTokens).toBeGreaterThan(0)
    expect(res.baseHash).toMatch(/^[a-f0-9]{40}$/)
    expect(res.finalHash).toMatch(/^[a-f0-9]{40}$/)
  })
})
