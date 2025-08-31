import fs from 'node:fs'
import path from 'node:path'
import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest'
import { makeSandbox } from './helpers/sandbox'

async function loadConfigFresh() {
  vi.resetModules()
  const mod: typeof import('../config') = await import('../config')
  return mod
}

describe('config.loadConfig (with sandbox)', () => {
  let sbx: ReturnType<typeof makeSandbox>
  let envBackup: NodeJS.ProcessEnv
  let cwdBackup: string

  beforeEach(() => {
    envBackup = { ...process.env }
    cwdBackup = process.cwd()

    sbx = makeSandbox('sentinel-config-')
    process.env.SENTINEL_REPO_ROOT = sbx.root
    process.chdir(sbx.root)
  })

  afterEach(() => {
    process.env = envBackup
    process.chdir(cwdBackup)
    sbx.cleanup()
  })

  function writeRc(dir: string, data: any) {
    fs.writeFileSync(path.join(dir, '.sentinelrc.json'), JSON.stringify(data, null, 2), 'utf8')
  }

  it('returns defaults when no rc and no env', async () => {
    const { loadConfig } = await loadConfigFresh()
    const cfg = loadConfig()
    expect(cfg.defaultProfile).toBe('frontend')
    expect(cfg.provider).toBe('local')
    expect(cfg.output?.dir).toBe(path.join(sbx.root, 'dist'))
    expect(cfg.output?.mdName).toBe('review.md')
    expect(cfg.output?.jsonName).toBe('review.json')
    expect(cfg.profilesDir).toBeUndefined()
  })

  it('merges rc from repo root and normalizes output.dir', async () => {
    writeRc(sbx.root, {
      defaultProfile: 'backend',
      provider: 'mock',
      output: { dir: 'build', mdName: 'x.md', jsonName: 'y.json' }
    })

    const { loadConfig } = await loadConfigFresh()
    const cfg = loadConfig()
    expect(cfg.defaultProfile).toBe('backend')
    expect(cfg.provider).toBe('mock')
    expect(cfg.output?.dir).toBe(path.join(sbx.root, 'build'))
    expect(cfg.output?.mdName).toBe('x.md')
    expect(cfg.output?.jsonName).toBe('y.json')
  })

  it('finds nearest .sentinelrc.json walking up, but not above repo root', async () => {
    writeRc(sbx.root, { defaultProfile: 'root-rc' })

    const deep = path.join(sbx.root, 'a/b/c')
    fs.mkdirSync(deep, { recursive: true })
    process.chdir(deep)

    {
      const { loadConfig } = await loadConfigFresh()
      const cfg = loadConfig()
      expect(cfg.defaultProfile).toBe('root-rc')
    }

    const parentOfRepo = path.dirname(sbx.root)
    const outsidePath = path.join(parentOfRepo, '.sentinelrc.json')

    try {
      fs.writeFileSync(outsidePath, JSON.stringify({ defaultProfile: 'outside' }), 'utf8')

      const { loadConfig } = await loadConfigFresh()
      const cfg = loadConfig()
      expect(cfg.defaultProfile).toBe('root-rc')
    } finally {
      try { fs.rmSync(outsidePath, { force: true }) } catch {}
    }
  })

  it('ENV overrides rc', async () => {
    writeRc(sbx.root, { defaultProfile: 'rc-prof', provider: 'mock' })

    process.env.SENTINEL_PROFILE = 'env-prof'
    process.env.SENTINEL_PROVIDER = 'openai'
    process.env.SENTINEL_OUT_DIR = 'out'
    process.env.SENTINEL_OUT_MD = 'env.md'
    process.env.SENTINEL_OUT_JSON = 'env.json'
    process.env.SENTINEL_MAX_COMMENTS = '7'
    process.env.SENTINEL_CONTEXT_INCLUDE_ADR = '0'
    process.env.SENTINEL_CONTEXT_INCLUDE_BOUNDARIES = '1'
    process.env.SENTINEL_CONTEXT_MAX_BYTES = '12345'
    process.env.SENTINEL_CONTEXT_MAX_TOKENS = '999'

    const { loadConfig } = await loadConfigFresh()
    const cfg = loadConfig()

    expect(cfg.defaultProfile).toBe('env-prof')
    expect(cfg.provider).toBe('openai')
    expect(cfg.maxComments).toBe(7)
    expect(cfg.output?.dir).toBe(path.join(sbx.root, 'out'))
    expect(cfg.output?.mdName).toBe('env.md')
    expect(cfg.output?.jsonName).toBe('env.json')

    expect(cfg.context?.includeADR).toBe(false)
    expect(cfg.context?.includeBoundaries).toBe(true)
    expect(cfg.context?.maxBytes).toBe(12345)
    expect(cfg.context?.maxApproxTokens).toBe(999)
  })

  it('CLI overrides highest priority (over env and rc)', async () => {
    writeRc(sbx.root, { defaultProfile: 'rc-prof', provider: 'mock' })
    process.env.SENTINEL_PROFILE = 'env-prof'
    process.env.SENTINEL_PROVIDER = 'openai'
    process.env.SENTINEL_OUT_DIR = 'env-out'

    const { loadConfig } = await loadConfigFresh()
    const cfg = loadConfig({
      defaultProfile: 'cli-prof',
      provider: 'claude',
      output: { dir: 'cli-out', mdName: 'cli.md', jsonName: 'cli.json' },
      context: { includeADR: true, includeBoundaries: false, maxBytes: 42, maxApproxTokens: 77 },
      profilesDir: 'profiles' // относительный → нормализуем
    })

    expect(cfg.defaultProfile).toBe('cli-prof')
    expect(cfg.provider).toBe('claude')
    expect(cfg.output?.dir).toBe(path.join(sbx.root, 'cli-out'))
    expect(cfg.output?.mdName).toBe('cli.md')
    expect(cfg.output?.jsonName).toBe('cli.json')
    expect(cfg.context?.includeADR).toBe(true)
    expect(cfg.context?.includeBoundaries).toBe(false)
    expect(cfg.context?.maxBytes).toBe(42)
    expect(cfg.context?.maxApproxTokens).toBe(77)

    expect(cfg.profilesDir).toBe(path.join(sbx.root, 'profiles'))
  })

  it('does not change absolute profilesDir', async () => {
    const absProfiles = path.join(sbx.root, 'custom-profiles')
    const { loadConfig } = await loadConfigFresh()
    const cfg = loadConfig({ profilesDir: absProfiles })
    expect(cfg.profilesDir).toBe(absProfiles)
  })
})
