import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

/**
 * Build AI context (Markdown) from profile docs:
 * - handbook/*.md
 * - rules/rules.json (+ optional boundaries.json)
 * - adr/* (optional)
 *
 * Output:
 *   dist/ai-review-context.md
 *
 * Design goals:
 * - Deterministic ordering and content hashing
 * - Clear section markers for downstream tooling
 * - Size guards (max bytes / approx tokens)
 * - Future-proof options (toggle ADR, include boundaries, etc.)
 */

export interface BuildContextOptions {
  profile: string                        // e.g. 'frontend'
  repoRoot?: string                      // default: process.cwd()
  outFile?: string                       // default: dist/ai-review-context.md
  includeADR?: boolean                   // default: true
  includeBoundaries?: boolean            // default: true
  prettyJson?: number | undefined        // default: 2
  maxBytes?: number                      // hard limit of output bytes; default: 1_500_000 (~1.5MB)
  maxApproxTokens?: number | undefined   // soft limit; if set, truncates ADR section first
}

type FileBlob = { path: string; content: string; bytes: number }

/** Normalize newlines, strip BOM, trim trailing spaces per line */
function normalizeText(s: string): string {
  // strip BOM
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1)
  // normalize to \n
  s = s.replace(/\r\n?/g, '\n')
  // trim trailing spaces
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

/** Approximate token count (very rough, good enough for guardrails) */
function approxTokens(s: string): number {
  // split by whitespace/punct, typical heuristic ~ 4 chars/token in English
  // We’ll just count words as tokens-ish.
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
  // allow *.md, *.adr.md, numeric prefixes
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

function ensureDir(p: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true })
}

/** Build a deterministic table of contents for a set of markdown files */
function buildTOC(blobs: FileBlob[], baseLabel: string): string {
  if (blobs.length === 0) return ''
  const rel = (p: string) => p.replace(/^.*?profiles\//, 'profiles/')
  const items = blobs.map(b => `- ${rel(b.path)}`).join('\n')
  return [
    `### ${baseLabel} TOC`,
    '',
    items,
    ''
  ].join('\n')
}

export function buildContext(opts: BuildContextOptions) {
  const {
    profile,
    repoRoot = process.cwd(),
    outFile = path.join(repoRoot, 'dist', 'ai-review-context.md'),
    includeADR = true,
    includeBoundaries = true,
    prettyJson = 2,
    maxBytes = 1_500_000,
    maxApproxTokens
  } = opts

  const profileRoot = path.join(repoRoot, 'profiles', profile, 'docs')

  const hbDir = path.join(profileRoot, 'handbook')
  const rulesPath = path.join(profileRoot, 'rules', 'rules.json')
  const boundariesPath = path.join(profileRoot, 'rules', 'boundaries.json')
  const adrDir = path.join(profileRoot, 'adr')

  // 1) Collect handbook
  const hbFiles = listMarkdown(hbDir)
  const hbBlobs = readBlobs(hbFiles)

  // 2) Read rules.json
  const rulesRaw = safeRead(rulesPath)
  if (!rulesRaw) {
    throw new Error(`rules.json not found: ${rulesPath}`)
  }
  let rulesPretty = ''
  try {
    const parsed = JSON.parse(rulesRaw)
    rulesPretty = JSON.stringify(parsed, null, prettyJson)
  } catch (e) {
    // Keep original if not valid JSON; downstream validator will fail anyway
    rulesPretty = rulesRaw
  }

  // 3) Read boundaries.json (optional)
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

  // 4) Collect ADR (optional)
  const adrFiles = includeADR ? listADR(adrDir) : []
  let adrBlobs = includeADR ? readBlobs(adrFiles) : []

  // Deterministic metadata
  const ts = new Date().toISOString()
  const meta = {
    profile,
    generatedAt: ts,
    handbookFiles: hbBlobs.map(b => b.path),
    rulesFile: rulesPath,
    boundariesFile: includeBoundaries && fs.existsSync(boundariesPath) ? boundariesPath : null,
    adrFiles: adrBlobs.map(b => b.path),
  }
  const metaPretty = JSON.stringify(meta, null, 2)

  // 5) Build sections with markers for downstream parsers
  const parts: string[] = []

  parts.push(`---`)
  parts.push(`title: Sentinel AI Review Context`)
  parts.push(`profile: ${profile}`)
  parts.push(`generatedAt: ${ts}`)
  parts.push(`hashSeed: ${sha1(JSON.stringify(meta))}`)
  parts.push(`---`)
  parts.push('')

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

  // Handbook
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

  // Rules
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

  // ADR (optional, can be truncated later by guardrails)
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

  // 6) Guardrails: trim by approx tokens first (drop ADR section if too big), then enforce byte limit
  if (maxApproxTokens) {
    const tokens = approxTokens(output)
    if (tokens > maxApproxTokens) {
      // Drop ADR completely first
      output = output.replace(
        /\n?<!-- SENTINEL:SECTION:ADR -->[\s\S]*?<!-- SENTINEL:SECTION:ADR:END -->/m,
        '\n<!-- SENTINEL:SECTION:ADR -->\n# ADR\n\n*Omitted due to context size constraints.*\n<!-- SENTINEL:SECTION:ADR:END -->\n'
      )
    }
  }

  // Enforce hard byte cap
  if (Buffer.byteLength(output, 'utf8') > maxBytes) {
    // As last resort, collapse handbook bodies but keep TOC and rules
    const collapsed = output
      .replace(
        /<!-- SENTINEL:SECTION:HANDBOOK -->[\s\S]*?<!-- SENTINEL:SECTION:HANDBOOK:END -->/m,
        '<!-- SENTINEL:SECTION:HANDBOOK -->\n# Handbook\n\n*Omitted due to size limit.*\n<!-- SENTINEL:SECTION:HANDBOOK:END -->\n'
      )
      .replace(
        /<!-- SENTINEL:SECTION:ADR -->[\s\S]*?<!-- SENTINEL:SECTION:ADR:END -->/m,
        '<!-- SENTINEL:SECTION:ADR -->\n# ADR\n\n*Omitted due to size limit.*\n<!-- SENTINEL:SECTION:ADR:END -->\n'
      )
    output = collapsed
  }

  // Final checksum (covers post-trim content)
  const finalHash = sha1(output)

  // Append footer with checksums for traceability
  output += '\n'
  output += '---\n'
  output += '## Checksums\n'
  output += '```json\n'
  output += JSON.stringify({ baseHash, finalHash }, null, 2) + '\n'
  output += '```\n'

  ensureDir(outFile)
  fs.writeFileSync(outFile, output, 'utf8')

  return {
    outFile,
    bytes: Buffer.byteLength(output, 'utf8'),
    approxTokens: approxTokens(output),
    baseHash,
    finalHash
  }
}

/**
 * Optional: small wrapper to use from CLI index (or directly)
 */
export async function buildContextCLI() {
  const profile = readArg('--profile', 'frontend')
  const outFile = readArg('--out', undefined)
  const includeADR = readBool('--include-adr', true)
  const includeBoundaries = readBool('--include-boundaries', true)
  const maxBytes = readInt('--max-bytes', 1_500_000)
  const maxApproxTokens = readInt('--max-tokens', undefined)

  const res = buildContext({
    profile,
    outFile,
    includeADR,
    includeBoundaries,
    maxBytes,
    maxApproxTokens
  })
  // UX output
  console.log(`[context] wrote ${res.outFile} (${res.bytes} bytes, ~${res.approxTokens} tokens)`)
  console.log(`[context] hash: ${res.finalHash}`)
}

function readArg(flag: string, fallback?: string) {
  const i = process.argv.indexOf(flag)
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]
  return fallback
}
function readBool(flag: string, fallback: boolean) {
  if (process.argv.includes(flag)) return true
  if (process.argv.includes(`--no-${flag.replace(/^--/, '')}`)) return false
  return fallback
}
function readInt(flag: string, fallback?: number) {
  const v = readArg(flag)
  if (v == null) return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

// Allow direct execution via ts-node if needed
if (import.meta.url === `file://${process.argv[1]}`) {
  buildContextCLI().catch(err => {
    console.error(err)
    process.exit(1)
  })
}
