import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { buildContext } from '../context'

/** утилита для создания мини-профиля */
function makeProfileTree(root: string, profile = 'frontend') {
  const profilesDir = path.join(root, 'profiles')
  const pRoot = path.join(profilesDir, profile)
  const hb = path.join(pRoot, 'docs', 'handbook')
  const rules = path.join(pRoot, 'docs', 'rules')
  const adr = path.join(pRoot, 'docs', 'adr')

  fs.mkdirSync(hb, { recursive: true })
  fs.mkdirSync(rules, { recursive: true })
  fs.mkdirSync(adr, { recursive: true })

  fs.writeFileSync(path.join(hb, 'architecture.md'), '# Arch\n\nA\n')
  fs.writeFileSync(path.join(hb, 'style.md'), '# Style\n\nB\n')

  fs.writeFileSync(path.join(rules, 'rules.json'), JSON.stringify({
    version: 1, domain: profile, rules: [{ id: 'r1', severity: 'minor' }]
  }, null, 2))

  fs.writeFileSync(path.join(rules, 'boundaries.json'), JSON.stringify({
    layers: [{ name: 'shared', path: 'src/shared/**', index: 1 }],
    forbidden: []
  }, null, 2))

  fs.writeFileSync(path.join(adr, '0001.md'), '# ADR-0001\n\nDecision.\n')

  return { profilesDir, pRoot }
}

describe('buildContext()', () => {
  let tmp: string
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-ctx-')) })
  afterEach(() => { try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {} })

  it('builds full context with handbook, rules, boundaries, adr (explicit profilesDir)', () => {
    const { profilesDir } = makeProfileTree(tmp, 'frontend')
    const out = path.join(tmp, 'dist', 'ai-review-context.md')

    const res = buildContext({
      profile: 'frontend',
      repoRoot: tmp,
      profilesDir,           // явно
      outFile: out,
      includeADR: true,
      includeBoundaries: true,
    })

    expect(fs.existsSync(out)).toBe(true)
    const md = fs.readFileSync(out, 'utf8')

    // шапка и метаданные
    expect(md).toMatch(/title: Sentinel AI Review Context/)
    expect(md).toMatch(/## Metadata/)
    expect(md).toMatch(/"rulesFile":/)

    // секции
    expect(md).toMatch(/<!-- SENTINEL:SECTION:HANDBOOK -->/)
    expect(md).toMatch(/# Rules/)
    expect(md).toMatch(/## Boundaries/)
    expect(md).toMatch(/<!-- SENTINEL:SECTION:ADR -->/)

    // футер с checksum
    expect(md).toMatch(/## Checksums/)
    expect(res.outFile).toBe(out)
    expect(res.counts.handbook).toBeGreaterThan(0)
    expect(res.counts.adr).toBe(1)
    expect(res.counts.hasBoundaries).toBe(true)
    expect(res.bytes).toBeGreaterThan(0)
    expect(res.baseHash).toBeTruthy()
    expect(res.finalHash).toBeTruthy()
  })

  it('auto-discovers profiles dir when not provided', () => {
    makeProfileTree(tmp, 'frontend')
    const out = path.join(tmp, 'dist', 'ctx.md')
    const res = buildContext({
      profile: 'frontend',
      repoRoot: tmp,          // важно, чтобы автопоиск шёл от этого корня
      outFile: out,
    })
    expect(fs.existsSync(out)).toBe(true)
    const md = fs.readFileSync(out, 'utf8')
    expect(md).toMatch(/# Handbook/)
    expect(res.counts.handbook).toBeGreaterThan(0)
  })

  it('omits ADR section when maxApproxTokens is exceeded', () => {
    const { profilesDir } = makeProfileTree(tmp, 'frontend')
    const out = path.join(tmp, 'dist', 'ctx-tokens.md')

    const res = buildContext({
      profile: 'frontend',
      repoRoot: tmp,
      profilesDir,
      outFile: out,
      maxApproxTokens: 1,    // заведомо мало
    })

    const md = fs.readFileSync(out, 'utf8')
    expect(md).toMatch(/ADR\n\n\*Omitted due to context size constraints\.\*/)
    expect(res.counts.adr).toBe(1) // в сырье ADR был, но в финале секция скрыта
  })

  it('cuts handbook & ADR when exceeding hard maxBytes', () => {
    const { profilesDir } = makeProfileTree(tmp, 'frontend')
    const out = path.join(tmp, 'dist', 'ctx-bytes.md')

    const res = buildContext({
      profile: 'frontend',
      repoRoot: tmp,
      profilesDir,
      outFile: out,
      maxBytes: 80, // достаточно мало, чтобы сработал guardrail
    })

    const md = fs.readFileSync(out, 'utf8')
    expect(md).toMatch(/\*Omitted due to size limit\.\*/) // и handbook, и ADR заменяются сообщениями
    expect(res.bytes).toBeGreaterThan(0)
  })

  it('throws when rules.json is missing', () => {
    // создаём профиль, затем удаляем rules.json
    const { profilesDir, pRoot } = makeProfileTree(tmp, 'frontend')
    fs.rmSync(path.join(pRoot, 'docs', 'rules', 'rules.json'))

    const out = path.join(tmp, 'dist', 'ctx-miss.md')
    expect(() => buildContext({
      profile: 'frontend',
      repoRoot: tmp,
      profilesDir,
      outFile: out,
    })).toThrow(/rules\.json not found/)
  })
})
