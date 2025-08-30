import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'

let initProfileCLI: typeof import('../init-profile').initProfileCLI

function read(p: string) { return fs.readFileSync(p, 'utf8') }
function exists(p: string) { return fs.existsSync(p) }
function list(dir: string) { return exists(dir) ? fs.readdirSync(dir).sort() : [] }

function profileRoot(repoRoot: string, name: string, base = path.join('packages', 'profiles')) {
  return path.join(repoRoot, base, name)
}
function rulesPath(root: string)      { return path.join(root, 'docs', 'rules', 'rules.json') }
function boundariesPath(root: string) { return path.join(root, 'docs', 'rules', 'boundaries.json') }
function hbDir(root: string)          { return path.join(root, 'docs', 'handbook') }
function adrDir(root: string)         { return path.join(root, 'docs', 'adr') }

describe('initProfileCLI', () => {
  let tmp: string
  let envBackup: NodeJS.ProcessEnv

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-init-profile-'))
    envBackup = { ...process.env }

    vi.resetModules()

    process.env.SENTINEL_REPO_ROOT = tmp

    ;({ initProfileCLI } = await import('../init-profile'))
  })

  afterEach(() => {
    process.env = envBackup
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
  })

  it('creates a full profile skeleton under packages/profiles/<name>', async () => {
    const name = 'hello-world'
    await initProfileCLI({ name })

    const root = profileRoot(tmp, name)
    expect(exists(root)).toBe(true)
    expect(exists(path.join(root, 'README.md'))).toBe(true)
    expect(list(hbDir(root))).toEqual([
      'architecture.md',
      'style.md',
      'testing.md',
    ])
    expect(exists(rulesPath(root))).toBe(true)
    expect(exists(boundariesPath(root))).toBe(true)
    expect(exists(adrDir(root))).toBe(false)

    const readme = read(path.join(root, 'README.md'))
    expect(readme).toMatch(`# ${name} Profile`)
    expect(readme).toMatch(`--profile ${name}`)

    const rules = JSON.parse(read(rulesPath(root)))
    expect(rules?.domain).toBe(name)
    expect(Array.isArray(rules?.rules)).toBe(true)
  })

  it('creates ADR starter when withAdr=true', async () => {
    const name = 'frontend-adr'
    await initProfileCLI({ name, withAdr: true })

    const root = profileRoot(tmp, name)
    const adr = adrDir(root)
    expect(exists(adr)).toBe(true)
    const files = list(adr)
    expect(files.length).toBeGreaterThan(0)
    expect(files[0]).toMatch(/0001.*\.md$/)
    const firstAdr = read(path.join(adr, files[0]!))
    expect(firstAdr).toMatch(/ADR-0001/i)
  })

  it('respects outDir override', async () => {
    const name = 'custom-out'
    await initProfileCLI({ name, outDir: 'profiles' })
    const root = profileRoot(tmp, name, 'profiles')
    expect(exists(root)).toBe(true)
    expect(exists(path.join(root, 'README.md'))).toBe(true)
  })

  it('is idempotent without force (existing files kept intact)', async () => {
    const name = 'idempotent'
    await initProfileCLI({ name })

    const root = profileRoot(tmp, name)
    const readmeFile = path.join(root, 'README.md')

    fs.writeFileSync(readmeFile, 'CUSTOM\n', 'utf8')
    await initProfileCLI({ name })
    const contentAfter = read(readmeFile)
    expect(contentAfter.startsWith('CUSTOM')).toBe(true)
  })

  it('overwrites files when force=true', async () => {
    const name = 'force-overwrite'
    await initProfileCLI({ name })

    const root = profileRoot(tmp, name)
    const readmeFile = path.join(root, 'README.md')
    fs.writeFileSync(readmeFile, 'CUSTOM\n', 'utf8')

    await initProfileCLI({ name, force: true })
    const contentAfter = read(readmeFile)
    expect(contentAfter).toMatch(`# ${name} Profile`)
    expect(contentAfter).not.toMatch(/^CUSTOM/)
  })

  it('throws on empty name', async () => {
    await expect(initProfileCLI({ name: '   ' }))
      .rejects.toThrow(/Profile name is required/i)
  })
})
