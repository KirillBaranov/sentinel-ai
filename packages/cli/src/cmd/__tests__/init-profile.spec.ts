import fs from 'node:fs'
import path from 'node:path'
import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest'
import { makeSandbox } from '../../__tests__/helpers/sandbox'

const profileRoot = (root: string, name: string, base = 'packages/profiles') =>
  path.join(root, base, name)

describe('initProfileCLI (with sandbox)', () => {
  let sbx: ReturnType<typeof makeSandbox>
  let envBackup: NodeJS.ProcessEnv
  let initProfileCLI: (opts: any) => Promise<{ root: string; created: string[]; skipped: string[] }>

  beforeEach(async () => {
    envBackup = { ...process.env }
    sbx = makeSandbox('sentinel-init-profile-')

    process.env.SENTINEL_REPO_ROOT = sbx.root
    vi.resetModules()

    const mod = await import('../init-profile')
    initProfileCLI = mod.initProfileCLI

    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    process.env = envBackup
    vi.restoreAllMocks()
    sbx.cleanup()
  })

  it('scaffolds a new profile under default packages/profiles', async () => {
    const name = 'frontend'
    const res = await initProfileCLI({ name })

    const root = profileRoot(sbx.root, name)
    expect(res.root).toBe(root)

    const expected = [
      'README.md',
      'docs/handbook/architecture.md',
      'docs/handbook/style.md',
      'docs/handbook/testing.md',
      'docs/rules/rules.json',
      'docs/rules/boundaries.json',
    ]
    for (const rel of expected) {
      const p = path.join(root, rel)
      expect(fs.existsSync(p)).toBe(true)
    }

    const rules = JSON.parse(
      fs.readFileSync(path.join(root, 'docs/rules/rules.json'), 'utf8')
    )
    expect(rules.domain).toBe(name)
    expect(
      fs.existsSync(path.join(root, 'docs/rules/boundaries.json'))
    ).toBe(true)
  })

  it('creates ADR starter when withAdr=true', async () => {
    const name = 'with-adr'
    const res = await initProfileCLI({ name, withAdr: true })

    const adrFile = path.join(
      res.root,
      'docs/adr/0001-record-architecture.md'
    )
    expect(fs.existsSync(adrFile)).toBe(true)

    const txt = fs.readFileSync(adrFile, 'utf8')
    expect(txt).toMatch(/ADR-0001/)
    expect(txt).toMatch(/Status:\s+accepted/)
  })

  it('is idempotent without force (existing files are skipped)', async () => {
    const name = 'idempotent'
    const root = profileRoot(sbx.root, name)

    await initProfileCLI({ name })

    const readmeFile = path.join(root, 'README.md')
    expect(fs.existsSync(readmeFile)).toBe(true)

    fs.writeFileSync(readmeFile, 'CUSTOM\n', 'utf8')

    const res2 = await initProfileCLI({ name })
    const readmeAfter = fs.readFileSync(readmeFile, 'utf8')
    expect(readmeAfter).toBe('CUSTOM\n')

    expect(res2.skipped.length).toBeGreaterThan(0)
    expect(res2.created.length).toBe(0)
  })

  it('overwrites files when force=true', async () => {
    const name = 'force-overwrite'
    const root = profileRoot(sbx.root, name)

    await initProfileCLI({ name })

    const readmeFile = path.join(root, 'README.md')
    fs.writeFileSync(readmeFile, 'CUSTOM\n', 'utf8')

    const res2 = await initProfileCLI({ name, force: true })
    const readmeAfter = fs.readFileSync(readmeFile, 'utf8')
    expect(readmeAfter).not.toBe('CUSTOM\n')
    expect(readmeAfter).toMatch(new RegExp(`^# ${name} Profile`))
    expect(res2.created.length).toBeGreaterThan(0)
  })

  it('supports custom outDir (absolute)', async () => {
    const name = 'custom-out'
    const outDir = path.join(sbx.root, 'profiles-custom-root')

    const res = await initProfileCLI({ name, outDir })

    expect(res.root).toBe(path.join(outDir, name))
    expect(fs.existsSync(path.join(res.root, 'docs/rules/rules.json'))).toBe(true)
  })
})
