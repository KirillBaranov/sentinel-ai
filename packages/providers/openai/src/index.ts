import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import OpenAI from 'openai'
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions'

import type {
  ReviewFinding,
  ReviewJson,
  RulesJson,
  Severity,
} from '@sentinel/core'
import type { ProviderReviewInput, ReviewProvider } from '@sentinel/provider-types'

/* ── tiny utils ────────────────────────────────────────────── */

function extractDiffFiles(diff: string): string[] {
  const set = new Set<string>();
  const re = /^\+\+\+\s+b\/(.+)$/gm;
  let m;
  while ((m = re.exec(diff))) set.add(m[1].trim());
  return Array.from(set);
}

const sha1 = (s: string) => crypto.createHash('sha1').update(s).digest('hex')
const fp = (f: Omit<ReviewFinding, 'fingerprint'>) =>
  sha1(`${f.rule}\n${f.file}\n${f.locator}\n${f.finding?.[0] ?? ''}`)

const rulesCompact = (rules?: RulesJson | null) =>
  rules?.rules?.length
    ? rules.rules
        .map(
          (r) =>
            `- id=${r.id} | area=${r.area} | severity=${r.severity}\n  ${r.description}`,
        )
        .join('\n')
    : '(none)'

function buildSystemPrompt() {
  return [
    'You are a rigorous code review assistant.',
    'Use the given CONTEXT (project handbook/rules/boundaries/ADR) to align suggestions.',
    'Given a unified DIFF, produce findings strictly as JSON.',
    'Only report actionable issues visible in the diff.',
    'Each finding must include: rule, area, severity, file, locator, finding[], why, suggestion.',
    'locator: "HUNK:@@ -a,b +c,d @@" OR "L42" OR "L10-L20" OR "symbol:Name".',
    'Each "finding[]" line must start with the locator in brackets, e.g. "[L45] message".',
    'If there are no issues, return [].',
  ].join(' ')
}

function buildUserPrompt(input: ProviderReviewInput) {
  const ctx = input.context?.markdown ?? ''
  const diff = input.diffText ?? ''
  const rulebook = rulesCompact(input.rules)
  const files = extractDiffFiles(diff)

  const hardConstraints = `
STRICT CONSTRAINTS:
- Only report findings for files from this allow-list:
  DIFF_FILES:
${files.map(f => `  - ${f}`).join('\n')}
- If a potential issue is outside DIFF_FILES (e.g., handbook/rules/docs), DO NOT report it.
- "file" must be EXACTLY one of DIFF_FILES; otherwise return [].
- Prefer line locators from hunks, e.g. "HUNK:@@ -a,b +c,d @@" or "L42".
`.trim()

  const schemaHint = `
Return ONLY valid JSON (UTF-8), no markdown, matching:

[
  {
    "rule": "string",
    "area": "string",
    "severity": "critical|major|minor|info",
    "file": "path/relative.ext",
    "locator": "HUNK:@@ -a,b +c,d @@|Lnum|Lstart-Lend|symbol:Name",
    "finding": ["[LOCATOR] message", "..."],
    "why": "short explanation",
    "suggestion": "short fix suggestion"
  }
]
`.trim()

  return [
    hardConstraints,
    `\nCONTEXT:\n${ctx.slice(0, 350_000)}`,
    `\nRULES (compact):\n${rulebook}`,
    `\nDIFF (unified):\n${diff.slice(0, 200_000)}`,
    `\n${schemaHint}`,
  ].join('\n')
}

/* ── debug helpers (safe, atomic) ──────────────────────────── */

function safeMkDir(dir: string) {
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {}
}
function atomicWrite(file: string, data: string | Buffer) {
  try {
    safeMkDir(path.dirname(file))
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
    fs.writeFileSync(tmp, data)
    fs.renameSync(tmp, file)
  } catch {}
}
function debugDump(dir: string, name: string, data: any, asText = false) {
  try {
    const p = path.join(dir, name)
    if (asText) {
      atomicWrite(p, String(data ?? ''))
    } else {
      atomicWrite(p, JSON.stringify(data, null, 2))
    }
  } catch {}
}

/* ── OpenAI call ───────────────────────────────────────────── */

async function callOpenAI(
  apiKey: string,
  model: string,
  temperature: number,
  maxTokens: number | undefined,
  systemPrompt: string,
  userPrompt: string,
  debugDir?: string,
) {
  const client = new OpenAI({ apiKey })

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]

  const payload: ChatCompletionCreateParamsNonStreaming = {
    model,
    temperature,
    max_tokens: maxTokens,
    messages,
    response_format: { type: 'json_object' },
  }

  if (debugDir) debugDump(debugDir, '10.request.payload.json', payload)

  const resp = await client.chat.completions.create(payload)

  if (debugDir) {
    debugDump(debugDir, '11.response.raw.json', resp)
    const content = resp.choices?.[0]?.message?.content?.trim() || ''
    debugDump(debugDir, '12.response.content.txt', content, true)
  }

  const content = resp.choices?.[0]?.message?.content?.trim() || ''
  // try parse as object/array
  try {
    const parsed = JSON.parse(content)
    if (Array.isArray(parsed)) return parsed
    if (parsed && Array.isArray((parsed as any).findings)) return (parsed as any).findings
  } catch {}
  // fallback to find JSON array in text
  const m = content.match(/\[\s*{[\s\S]*}\s*\]/)
  if (m) {
    try {
      return JSON.parse(m[0])
    } catch {}
  }
  return []
}

/* ── Provider ──────────────────────────────────────────────── */

export const openaiProvider: ReviewProvider = {
  name: 'openai',
  async review(input: ProviderReviewInput): Promise<ReviewJson> {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set')

    const model = input.providerOptions?.model || process.env.SENTINEL_MODEL || 'gpt-4o-mini'
    const temperature = input.providerOptions?.temperature ?? 0
    const maxTokens = input.providerOptions?.maxTokens

    // debug toggle/dir (CLI уже передаёт input.debug; поддержим и env-флаг для удобства)
    const debugEnabled =
      !!input.debug?.enabled ||
      (process.env.SENTINEL_DEBUG_PROVIDER === '1' || process.env.SENTINEL_DEBUG_PROVIDER === 'true')
    const debugDir =
      input.debug?.dir ||
      (debugEnabled && input.repoRoot
        ? path.join(input.repoRoot, '.sentinel', 'reviews', input.profile || 'default', 'debug')
        : undefined)

    // inputs (доступны в любом случае)
    const diff = input.diffText || ''
    const ctx = input.context?.markdown || ''

    if (debugEnabled && debugDir) {
      safeMkDir(debugDir)
      // inputs
      debugDump(debugDir, '00.input.meta.json', {
        provider: 'openai',
        model,
        temperature,
        maxTokens,
        repoRoot: input.repoRoot,
        profile: input.profile,
        diff_bytes: Buffer.byteLength(diff, 'utf8'),
        diff_sha1: sha1(diff),
        context_bytes: Buffer.byteLength(ctx, 'utf8'),
        context_sha1: sha1(ctx),
        rules_count: input.rules?.rules?.length || 0,
        providerOptions: input.providerOptions,
      })
      debugDump(debugDir, '01.input.diff.unified.patch', diff, true)
      debugDump(debugDir, '02.input.context.md', ctx, true)
      debugDump(debugDir, '03.input.rules.compact.txt', rulesCompact(input.rules), true)
      debugDump(debugDir, '04.input.diff.files.json', extractDiffFiles(diff))
    }

    // prompts
    const systemPrompt = buildSystemPrompt()
    const userPrompt = buildUserPrompt(input)

    // openai
    const raw = await callOpenAI(
      apiKey,
      model,
      temperature,
      maxTokens,
      systemPrompt,
      userPrompt,
      debugEnabled ? debugDir : undefined,
    )

    // normalize findings
    const findings: ReviewFinding[] = []
    if (Array.isArray(raw)) {
      for (const it of raw) {
        const base = {
          rule: String((it as any).rule ?? 'unknown'),
          area: String((it as any).area ?? 'general'),
          severity: (['critical', 'major', 'minor', 'info'] as Severity[]).includes(
            (it as any).severity,
          )
            ? (it as any).severity
            : ('minor' as Severity),
          file: String((it as any).file ?? 'unknown'),
          locator: String((it as any).locator ?? 'L0'),
          finding: Array.isArray((it as any).finding)
            ? (it as any).finding.map((s: any) => String(s))
            : [],
          why: String((it as any).why ?? ''),
          suggestion: String((it as any).suggestion ?? ''),
        }
        findings.push({ ...base, fingerprint: fp(base) })
      }
    }

    if (debugEnabled && debugDir) {
      debugDump(debugDir, '20.output.findings.json', findings)
    }

    // allow-list by DIFF files (safety net)
    const allowed = new Set(extractDiffFiles(diff))
    const filtered = findings.filter(f => allowed.has(f.file) && (f.finding?.length ?? 0) > 0)
    if (debugEnabled && debugDir) {
      const dropped = findings.filter(f => !allowed.has(f.file))
      debugDump(debugDir, '21.output.findings.filtered.json', filtered)
      if (dropped.length) debugDump(debugDir, '22.output.findings.dropped.json', dropped)
    }

    return { ai_review: { version: 1 as const, run_id: `run_${Date.now()}`, findings: filtered } }
  },
}

export default openaiProvider
