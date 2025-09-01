import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { findRepoRoot } from '../cli-utils'
import { describe, it, expect } from 'vitest'

function mkdirp(p: string) { fs.mkdirSync(p, { recursive: true }) }

describe('findRepoRoot', () => {
  it('respects SENTINEL_REPO_ROOT', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-'))
    process.env.SENTINEL_REPO_ROOT = tmp
    expect(findRepoRoot('/some/where')).toBe(tmp)
    delete process.env.SENTINEL_REPO_ROOT
  })

  it('walks up until .git or pnpm-workspace.yaml', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-'))
    const a = path.join(tmp, 'a')
    const b = path.join(a, 'b')
    mkdirp(b)
    fs.writeFileSync(path.join(tmp, 'pnpm-workspace.yaml'), '')
    expect(findRepoRoot(b)).toBe(tmp)
  })

  it('falls back to start if not found', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-'))
    const d = path.join(tmp, 'a', 'b')
    mkdirp(d)
    expect(findRepoRoot(d)).toBe(path.resolve(d))
  })
})
