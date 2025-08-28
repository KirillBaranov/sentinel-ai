import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

/**
 * Build AI context (Markdown) from profile docs:
 * - handbook/*.md
 * - rules/rules.json (+ optional boundaries.json)
 * - adr/* (optional)
 *
 * Output:
 *   dist/ai-review-context.md  (в корне репозитория)
 */

export interface BuildContextOptions {
  profile: string                        // e.g. 'frontend'
  repoRoot?: string                      // default: <REPO_ROOT> (из пути файла)
  profilesDir?: string                   // default: auto-discover (profiles | packages/profiles)
  outFile?: string                       // default: dist/ai-review-context.md (в корне)
  includeADR?: boolean                   // default: true
  includeBoundaries?: boolean            // default: true
  prettyJson?: number | undefined        // default: 2
  maxBytes?: number                      // hard limit ~1.5MB
  maxApproxTokens?: number | undefined   // soft limit; если задан, сначала режем ADR
}

type FileBlob = { path: string; content: string; bytes: number }

// ── вычисляем корень репо относительно packages/cli/src/context.ts
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../../../')

/** Normalize newlines, strip BOM, trim trailing spaces per line */
function normalizeText(s: string): string {
  if (s.length && s.charCodeAt(0) === 0xfeff) s = s.slice(1)
  s = s.replace(/\r\n?/g, '\n')
  s = s.split('\n').map(l => l.replace(/[ \t]+$/g, '')).join('\n')
  return s
}

function sha1(buf: string | Buffer) {
  return crypto.createHash('sha1').update(buf).digest('hex')
}

function safeRead(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf8')
  } catch {
    return null
  }
}

/** Approximate token count (очень грубо) */
function approxTokens(s: string): number {
  return s.split(/\s+/g).filter(Boolean).length
}

function listMarkdown(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter(f => f.toLowerCase().endsWith('.md'))
    .map(f => path.join(dir, f))
    .sort((a, b) => a.localeCompare(b))
}

function listADR(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter(f => /\.md$/i.test(f))
    .map(f => path.join(dir, f))
    .sort((a, b) => a.localeCompare(b))
}

function readBlobs(files: string[]): FileBlob[] {
  const out: FileBlob[] = []
  for (const p of files) {
    const raw = safeRead(p)
    if (!raw) continue
    const content = normalizeText(raw)
    out.push({ path: p, content, bytes: Buffer.byteLength(content, 'utf8') })
  }
  return out
}

function ensureDirForFile(p: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true })
}

/** Build a deterministic table of contents for a set of markdown files */
function buildTOC(blobs: FileBlob[], baseLabel: string): string {
  if (blobs.length === 0) return ''
  const rel = (p: string) => p.replace(/^.*?profiles\//, 'profiles/')
  const items = blobs.map(b => `- ${rel(b.path)}`).join('\n')
  return [`### ${baseLabel} TOC`, '', items, ''].join('\n')
}

function resolveProfilesDir(repoRoot: string, explicit?: string): string {
  // 1) явный приоритет: аргумент или ENV
  const envDir = process.env.SENTINEL_PROFILES_DIR
  const candidateExplicit = explicit ?? envDir
  if (candidateExplicit) {
    const abs = path.isAbsolute(candidateExplicit)
      ? candidateExplicit
      : path.join(repoRoot, candidateExplicit)
    if (fs.existsSync(abs)) return abs
    throw new Error(`profiles dir not found (explicit): ${abs}`)
  }

  // 2) авто-поиск по распространённым локациям
  const candidates = [
    path.join(repoRoot, 'profiles'),
    path.join(repoRoot, 'packages', 'profiles')
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }

  throw new Error(
    `profiles dir not found. Tried:\n` +
    candidates.map(c => ` - ${c}`).join('\n') +
    `\nYou can pass --profiles-dir or set SENTINEL_PROFILES_DIR.`
  )
}

export function buildContext(opts: BuildContextOptions) {
  const {
    profile,
    repoRoot = REPO_ROOT,
    profilesDir, // может быть относительным или абсолютным
    outFile = path.join(repoRoot, 'dist', 'ai-review-context.md'),
    includeADR = true,
    includeBoundaries = true,
    prettyJson = 2,
    maxBytes = 1_500_000,
    maxApproxTokens
  } = opts

  const PROFILES_DIR = resolveProfilesDir(repoRoot, profilesDir)
  const profileDocs = path.join(PROFILES_DIR, profile, 'docs')

  const hbDir = path.join(profileDocs, 'handbook')
  const rulesPath = path.join(profileDocs, 'rules', 'rules.json')
  const boundariesPath = path.join(profileDocs, 'rules', 'boundaries.json')
  const adrDir = path.join(profileDocs, 'adr')

  // 1) Handbook
  const hbFiles = listMarkdown(hbDir)
  const hbBlobs = readBlobs(hbFiles)

  // 2) Rules
  const rulesRaw = safeRead(rulesPath)
  if (!rulesRaw) throw new Error(`rules.json not found: ${rulesPath}`)
  let rulesPretty = ''
  try {
    rulesPretty = JSON.stringify(JSON.parse(rulesRaw), null, prettyJson)
  } catch {
    rulesPretty = rulesRaw
  }

  // 3) Boundaries (optional)
  let boundariesPretty = ''
  if (includeBoundaries) {
    const boundariesRaw = safeRead(boundariesPath)
    if (boundariesRaw) {
      try {
        boundariesPretty = JSON.stringify(JSON.parse(boundariesRaw), null, prettyJson)
      } catch {
        boundariesPretty = boundariesRaw
      }
    }
  }

  // 4) ADR (optional)
  const adrFiles = includeADR ? listADR(adrDir) : []
  let adrBlobs = includeADR ? readBlobs(adrFiles) : []

  // Metadata
  const ts = new Date().toISOString()
  const meta = {
    profile,
    profilesDir: PROFILES_DIR,
    generatedAt: ts,
    handbookFiles: hbBlobs.map(b => b.path),
    rulesFile: rulesPath,
    boundariesFile: includeBoundaries && fs.existsSync(boundariesPath) ? boundariesPath : null,
    adrFiles: adrBlobs.map(b => b.path)
  }
  const metaPretty = JSON.stringify(meta, null, 2)

  // Sections
  const parts: string[] = []

  parts.push('---')
  parts.push('title: Sentinel AI Review Context')
  parts.push(`profile: ${profile}`)
  parts.push(`generatedAt: ${ts}`)
  parts.push(`hashSeed: ${sha1(JSON.stringify(meta))}`)
  parts.push('---')
  parts.push('')

  // SUMMARY
  parts.push('<!-- SENTINEL:SECTION:SUMMARY -->')
  parts.push('# Sentinel AI — Review Context')
  parts.push('')
  parts.push('This document is the single source of truth for the current review run. It includes the profile handbook, rules, and optional ADRs. Use it to ground AI-based review.')
  parts.push('')
  parts.push('## Metadata')
  parts.push('```json')
  parts.push(metaPretty)
  parts.push('```')
  parts.push('<!-- SENTINEL:SECTION:SUMMARY:END -->')
  parts.push('')

  // HANDBOOK
  parts.push('<!-- SENTINEL:SECTION:HANDBOOK -->')
  parts.push('# Handbook')
  parts.push('')
  parts.push(buildTOC(hbBlobs, 'Handbook'))
  for (const blob of hbBlobs) {
    parts.push(`## ${path.basename(blob.path)}`)
    parts.push('')
    parts.push(blob.content)
    parts.push('')
    parts.push('---')
    parts.push('')
  }
  parts.push('<!-- SENTINEL:SECTION:HANDBOOK:END -->')
  parts.push('')

  // RULES
  parts.push('<!-- SENTINEL:SECTION:RULES -->')
  parts.push('# Rules')
  parts.push('')
  parts.push('> Source: `profiles/<profile>/docs/rules/rules.json`')
  parts.push('```json')
  parts.push(rulesPretty)
  parts.push('```')
  if (boundariesPretty) {
    parts.push('')
    parts.push('## Boundaries')
    parts.push('> Source: `profiles/<profile>/docs/rules/boundaries.json`')
    parts.push('```json')
    parts.push(boundariesPretty)
    parts.push('```')
  }
  parts.push('<!-- SENTINEL:SECTION:RULES:END -->')
  parts.push('')

  // ADR
  if (includeADR && adrBlobs.length > 0) {
    parts.push('<!-- SENTINEL:SECTION:ADR -->')
    parts.push('# ADR')
    parts.push('')
    parts.push(buildTOC(adrBlobs, 'ADR'))
    for (const blob of adrBlobs) {
      parts.push(`## ${path.basename(blob.path)}`)
      parts.push('')
      parts.push(blob.content)
      parts.push('')
      parts.push('---')
      parts.push('')
    }
    parts.push('<!-- SENTINEL:SECTION:ADR:END -->')
    parts.push('')
  }

  let output = parts.join('\n')
  const baseHash = sha1(output)

  // Guardrails — soft (tokens)
  if (maxApproxTokens) {
    const tokens = approxTokens(output)
    if (tokens > maxApproxTokens) {
      output = output.replace(
        /\n?<!-- SENTINEL:SECTION:ADR -->[\s\S]*?<!-- SENTINEL:SECTION:ADR:END -->/m,
        '\n<!-- SENTINEL:SECTION:ADR -->\n# ADR\n\n*Omitted due to context size constraints.*\n<!-- SENTINEL:SECTION:ADR:END -->\n'
      )
    }
  }

  // Guardrails — hard (bytes)
  if (Buffer.byteLength(output, 'utf8') > maxBytes) {
    output = output
      .replace(
        /<!-- SENTINEL:SECTION:HANDBOOK -->[\s\S]*?<!-- SENTINEL:SECTION:HANDBOOK:END -->/m,
        '<!-- SENTINEL:SECTION:HANDBOOK -->\n# Handbook\n\n*Omitted due to size limit.*\n<!-- SENTINEL:SECTION:HANDBOOK:END -->\n'
      )
      .replace(
        /<!-- SENTINEL:SECTION:ADR -->[\s\S]*?<!-- SENTINEL:SECTION:ADR:END -->/m,
        '<!-- SENTINEL:SECTION:ADR -->\n# ADR\n\n*Omitted due to size limit.*\n<!-- SENTINEL:SECTION:ADR:END -->\n'
      )
  }

  // Final checksum
  const finalHash = sha1(output)

  // Footer with checksums
  output += '\n---\n## Checksums\n```json\n'
  output += JSON.stringify({ baseHash, finalHash }, null, 2) + '\n'
  output += '```\n'

  ensureDirForFile(outFile)
  fs.writeFileSync(outFile, output, 'utf8')

  return {
    outFile,
    bytes: Buffer.byteLength(output, 'utf8'),
    approxTokens: approxTokens(output),
    baseHash,
    finalHash
  }
}

/** CLI wrapper */
export async function buildContextCLI() {
  const profile = readArg('--profile', 'frontend')
  const outFile = readArg('--out', undefined)
  const repoRoot = readArg('--repo-root', REPO_ROOT)
  const profilesDir = readArg('--profiles-dir', undefined) // можно передать относительный
  const includeADR = readBool('--include-adr', true)
  const includeBoundaries = readBool('--include-boundaries', true)
  const maxBytes = readInt('--max-bytes', 1_500_000)
  const maxApproxTokens = readInt('--max-tokens', undefined)

  const res = buildContext({
    profile,
    outFile,
    repoRoot,
    profilesDir,
    includeADR,
    includeBoundaries,
    maxBytes,
    maxApproxTokens
  })
  console.log(
    `[context] wrote ${path.relative(String(repoRoot), res.outFile)} ` +
    `(${res.bytes} bytes, ~${res.approxTokens} tokens)`
  )
  console.log(`[context] hash: ${res.finalHash}`)
}

/** tiny argv helpers */
function readArg(flag: string, fallback?: string) {
  const i = process.argv.indexOf(flag)
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]
  return fallback
}
function readBool(flag: string, fallback: boolean) {
  const name = flag.replace(/^--/, '')
  if (process.argv.includes(flag)) return true
  if (process.argv.includes(`--no-${name}`)) return false
  return fallback
}
function readInt(flag: string, fallback?: number) {
  const v = readArg(flag)
  if (v == null) return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

// Allow direct execution via node/tsx
if (import.meta.url === `file://${process.argv[1]}`) {
  buildContextCLI().catch(err => {
    console.error(err)
    process.exit(1)
  })
}
