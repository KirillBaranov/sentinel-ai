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
  const set = new Set<string>()
  const re = /^\+\+\+\s+b\/(.+)$/gm
  let m
  while ((m = re.exec(diff))) set.add(m[1]!.trim())
  return Array.from(set)
}

function addedLinesByFile(diff: string): Record<string, { line: number; text: string }[]> {
  const out: Record<string, { line: number; text: string }[]> = {}
  let file = ''
  let newLine = 0
  const lines = diff.split('\n')
  for (const line of lines) {
    if (line.startsWith('+++ b/')) {
      file = line.slice(6).trim()
      if (!out[file]) out[file] = []
      continue
    }
    const m = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (m) {
      newLine = Number(m[1])
      continue
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      if (file) out[file]!.push({ line: newLine, text: line.slice(1) })
      newLine++
    } else if (!line.startsWith('-')) {
      // context line
      if (line && !line.startsWith('@@')) newLine++
    }
  }
  return out
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

function ruleIds(rules?: RulesJson | null): string[] {
  return (rules?.rules ?? []).map((r) => String(r.id))
}

/* ── constraints derived from rules.trigger ────────────────── */

type RuleConstraint = {
  id: string
  area?: string
  severity?: string
  evidence?: 'added-only' | 'diff-any'
  requireSignalMatch?: boolean
  signals: string[]
  exempt: string[]
  file_glob?: string[]
}

function deriveRuleConstraints(rules?: RulesJson | null): RuleConstraint[] {
  const out: RuleConstraint[] = []
  if (!rules?.rules?.length) return out

  for (const r of rules.rules) {
    const t: any = r.trigger || {}
    const rc: RuleConstraint = {
      id: String(r.id),
      area: r.area,
      severity: r.severity,
      evidence: t.evidence === 'diff-any' ? 'diff-any' : 'added-only',
      requireSignalMatch: !!t.requireSignalMatch,
      signals: Array.isArray(t.signals) ? t.signals.map(String) : [],
      exempt: Array.isArray(t.exempt) ? t.exempt.map(String) : [],
      file_glob: Array.isArray(t.file_glob) ? t.file_glob.map(String) : undefined,
    }
    out.push(rc)
  }

  return out
}

function formatRuleConstraints(rcs: RuleConstraint[]): string {
  if (!rcs.length) return '(none)'
  return rcs
    .map((rc) => {
      const lines = []
      lines.push(`- rule: ${rc.id}`)
      if (rc.area) lines.push(`  area: ${rc.area}`)
      if (rc.severity) lines.push(`  severity: ${rc.severity}`)
      lines.push(`  evidence: ${rc.evidence || 'added-only'}`)
      lines.push(`  requireSignalMatch: ${rc.requireSignalMatch ? 'true' : 'false'}`)
      if (rc.file_glob?.length) lines.push(`  file_glob:\n    - ${rc.file_glob.join('\n    - ')}`)
      if (rc.signals.length) lines.push(`  signals:\n    - ${rc.signals.join('\n    - ')}`)
      if (rc.exempt.length) lines.push(`  exempt:\n    - ${rc.exempt.join('\n    - ')}`)
      return lines.join('\n')
    })
    .join('\n')
}

/* ── prompt builders ───────────────────────────────────────── */

function buildSystemPrompt() {
  return [
    'You are a rigorous code review assistant.',
    'Use ONLY the provided RULES and CONTEXT (team handbook, boundaries, ADRs).',
    'Given a unified DIFF, produce findings strictly as JSON.',
    'Report ONLY issues explicitly evidenced in the DIFF under the constraints provided.',
    'Prefer ADDED lines (prefixed with "+") as evidence unless a rule declares a wider scope.',
    'Only report findings for files explicitly listed under DIFF_FILES.',
    '',
    'SIGNAL & EVIDENCE POLICY:',
    '- For a rule with `requireSignalMatch=true`, at least one of its `signals` must literally match applicable text according to `evidence`.',
    '- `evidence: "added-only"` → match inside ADDED lines.',
    '- `evidence: "diff-any"` → match inside the diff (provider may still prioritize ADDED lines).',
    '- Apply `exempt` patterns as allowlist: if an added line matches any `exempt` for the same rule, do not report it.',
    '',
    'OUTPUT RULES:',
    '- Each finding must include: rule, area, severity, file, locator, finding[], why, suggestion.',
    '- The "file" field MUST exactly match one of the DIFF_FILES.',
    '- The "locator" must point to an added line or a hunk header (e.g., "HUNK:@@ -a,b +c,d @@", "L42", "L10-L20").',
    '- Each "finding[]" item must start with the locator in brackets, e.g. "[L45] message", and quote the triggering text.',
    '- If uncertain, return {"findings": []}.',
    'Return a single JSON object with the key "findings" (an array).',
  ].join(' ')
}

function buildUserPrompt(input: ProviderReviewInput) {
  const ctx = input.context?.markdown ?? ''
  const diff = input.diffText ?? ''
  const rulebook = rulesCompact(input.rules)
  const files = extractDiffFiles(diff)
  const ids = ruleIds(input.rules)
  const added = addedLinesByFile(diff)
  const constraints = deriveRuleConstraints(input.rules)

  const diffFilesSection = files.length
    ? files.map((f) => `  - ${f}`).join('\n')
    : '  (none)'
  const addedSection = files
    .map((f) => {
      const rows = (added[f] || []).map((a) => `${a.line}: ${a.text}`).join('\n')
      return `# ${f}\n${rows || '(no added lines)'}\n`
    })
    .join('\n')

  const hardConstraints = `
STRICT CONSTRAINTS:
- Report findings ONLY for files in DIFF_FILES.
- Use ADDED lines as evidence unless a rule declares otherwise via "evidence".
- Anchor each finding to actual lines with a precise locator.
- Apply only the provided RULES; do not invent policies beyond them.
- RULE_ID must be one of RULE_IDS exactly. If a rule cannot be satisfied under its constraints, do not report it.
- When in doubt, return an empty findings list.
`.trim()

  const constraintsText = formatRuleConstraints(constraints)

  const schemaHint = `
Return ONLY valid JSON (UTF-8), no markdown:
{
  "findings": [
    {
      "rule": "<one of RULE_IDS>",
      "area": "string",
      "severity": "critical|major|minor|info",
      "file": "path/relative.ext",
      "locator": "HUNK:@@ -a,b +c,d @@|Lnum|Lstart-Lend|symbol:Name",
      "finding": ["[LOCATOR] message", "..."],
      "why": "short explanation citing the matched evidence",
      "suggestion": "short fix suggestion"
    }
  ]
}
`.trim()

  return [
    hardConstraints,
    `\nRULE_IDS:\n${ids.map((i) => `  - ${i}`).join('\n') || '  (none)'}`,
    `\nRULE_CONSTRAINTS (derived from rules.trigger):\n${constraintsText}`,
    `\nRULES (compact):\n${rulebook}`,
    `\nCONTEXT:\n${ctx.slice(0, 300_000)}`,
    `\nDIFF_FILES:\n${diffFilesSection}`,
    `\nADDED_LINES (per-file):\n${addedSection}`,
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

/* ── minimal signal check helpers (best-effort, per rule) ──── */

function compileMatcher(signal: string): (s: string) => boolean {
  if (signal.startsWith('regex:')) {
    const pat = signal.slice(6)
    const re = new RegExp(pat, 'm')
    return (s: string) => re.test(s)
  }
  if (signal.startsWith('added-line:')) {
    const lit = signal.slice(11)
    return (s: string) => s.includes(lit)
  }
  if (signal.startsWith('pattern:')) {
    const lit = signal.slice(8)
    return (s: string) => s.includes(lit)
  }
  // default literal substring
  return (s: string) => s.includes(signal)
}

function anyMatch(lines: string[], signals: string[]): boolean {
  const matchers = signals.map(compileMatcher)
  return lines.some((line) => matchers.some((m) => m(line)))
}

function anyExempt(lines: string[], exempts: string[]): boolean {
  if (!exempts.length) return false
  const matchers = exempts.map(compileMatcher)
  return lines.some((line) => matchers.some((m) => m(line)))
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
    const contentPeek = resp.choices?.[0]?.message?.content?.slice(0, 2000) || ''
    debugDump(debugDir, '12.response.content.peek.txt', contentPeek, true)
  }

  const content = resp.choices?.[0]?.message?.content?.trim() || ''
  try {
    const parsed = JSON.parse(content)
    if (Array.isArray(parsed)) return parsed
    if (parsed && Array.isArray((parsed as any).findings)) return (parsed as any).findings
  } catch {}
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

    // debug toggle/dir
    const debugEnabled =
      !!input.debug?.enabled ||
      (process.env.SENTINEL_DEBUG_PROVIDER === '1' || process.env.SENTINEL_DEBUG_PROVIDER === 'true')
    const debugDir =
      input.debug?.dir ||
      (debugEnabled && input.repoRoot
        ? path.join(input.repoRoot, '.sentinel', 'reviews', input.profile || 'default', 'debug')
        : undefined)

    const diff = input.diffText || ''
    const ctx = input.context?.markdown || ''

    const files = extractDiffFiles(diff)
    const ids = ruleIds(input.rules)
    const added = addedLinesByFile(diff)
    const constraints = deriveRuleConstraints(input.rules)

    if (debugEnabled && debugDir) {
      safeMkDir(debugDir)
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
      debugDump(debugDir, '04.input.diff.files.json', files)
      debugDump(debugDir, '05.input.rule_ids.json', ids)
      debugDump(debugDir, '06.input.added_lines.json', added)
      debugDump(debugDir, '07.input.rule_constraints.json', constraints)
    }

    const systemPrompt = buildSystemPrompt()
    const userPrompt = buildUserPrompt(input)

    const raw = await callOpenAI(
      apiKey,
      model,
      temperature,
      maxTokens,
      systemPrompt,
      userPrompt,
      debugEnabled ? debugDir : undefined,
    )

    const findings: ReviewFinding[] = []
    if (Array.isArray(raw)) {
      for (const itRaw of raw) {
        const it = itRaw as any
        const base = {
          rule: String(it.rule ?? ''),
          area: String(it.area ?? ''),
          severity: (['critical', 'major', 'minor', 'info'] as Severity[]).includes(it.severity)
            ? it.severity
            : ('minor' as Severity),
          file: String(it.file ?? ''),
          locator: String(it.locator ?? ''),
          finding: Array.isArray(it.finding) ? it.finding.map((s: any) => String(s)) : [],
          why: String(it.why ?? ''),
          suggestion: String(it.suggestion ?? ''),
        }

        if (!base.rule || !ids.includes(base.rule)) continue
        if (!base.file || !files.includes(base.file)) continue

        // Best-effort gating according to rule constraints
        const rc = constraints.find((c) => c.id === base.rule)
        const fileAdded = (added[base.file] || []).map((a) => a.text)

        if (rc?.requireSignalMatch) {
          // Evidence policy: currently we check ADDED lines for both modes (safe default).
          const linesForCheck = fileAdded
          const isExempt = rc.exempt?.length ? anyExempt(linesForCheck, rc.exempt) : false
          const hasSignal = rc.signals?.length ? anyMatch(linesForCheck, rc.signals) : false
          if (isExempt || !hasSignal) continue
        }

        console.log('hello-world')

        // optional: ensure at least one finding item references an added line (best-effort)
        const evidenceOK =
          base.finding.length === 0
            ? true
            : base.finding.some((msg: any) => {
                const stripped = String(msg).replace(/^\[[^\]]+\]\s*/, '')
                return fileAdded.some((line) =>
                  stripped.includes(line.slice(0, Math.min(20, line.length))),
                )
              })

        if (!evidenceOK) continue

        findings.push({
          ...base,
          fingerprint: fp({
            rule: base.rule,
            area: base.area || 'general',
            severity: base.severity,
            file: base.file,
            locator: base.locator || 'L0',
            finding: base.finding,
            why: base.why,
            suggestion: base.suggestion,
          }),
        })
      }
    }

    if (debugEnabled && debugDir) {
      debugDump(debugDir, '20.output.findings.json', findings)
    }

    return { ai_review: { version: 1 as const, run_id: `run_${Date.now()}`, findings } }
  },
}

export default openaiProvider
