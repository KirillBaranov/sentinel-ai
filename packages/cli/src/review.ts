import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  parseUnifiedDiff,
  makeFingerprint,
  type ReviewFinding,
  type ReviewJson,
} from '@sentinel/core'

import type { RulesJson, RuleItem } from '@sentinel/core/dist/lib/types.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../../../')

function ensureDirForFile(p: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true })
}

function resolveProfilesDir(repoRoot: string, explicit?: string) {
  const envDir = process.env.SENTINEL_PROFILES_DIR
  const wanted = explicit ?? envDir
  if (wanted) {
    const abs = path.isAbsolute(wanted) ? wanted : path.join(repoRoot, wanted)
    if (fs.existsSync(abs)) return abs
    throw new Error(`profiles dir not found (explicit): ${abs}`)
  }
  const candidates = [
    path.join(repoRoot, 'profiles'),
    path.join(repoRoot, 'packages', 'profiles'),
  ]
  for (const c of candidates) if (fs.existsSync(c)) return c
  throw new Error(`profiles dir not found, tried:\n${candidates.join('\n')}`)
}

function loadRules(
  profile: string,
  profilesDir?: string
): { byId: Map<string, RuleItem>; raw: RulesJson | null } {
  const PROFILES = resolveProfilesDir(REPO_ROOT, profilesDir)
  const rulesPath = path.join(PROFILES, profile, 'docs', 'rules', 'rules.json')
  try {
    const raw = JSON.parse(fs.readFileSync(rulesPath, 'utf8')) as RulesJson
    const byId = new Map<string, RuleItem>()
    for (const r of raw.rules) byId.set(r.id, r)
    return { byId, raw }
  } catch {
    console.warn(`[review] rules.json not found or invalid for profile=${profile}. Looked at: ${rulesPath}`)
    return { byId: new Map(), raw: null }
  }
}

function metaFor(
  ruleId: string,
  rules: Map<string, RuleItem>
): { area: string; severity: 'critical' | 'major' | 'minor' | 'info' } {
  const r = rules.get(ruleId)
  if (r) return { area: r.area, severity: r.severity }
  return { area: 'Style', severity: 'minor' }
}

export async function runReviewCLI(opts: {
  diff: string
  profile: string
  outMd: string         // транспортный файл (Markdown с JSON-блоком)
  outJson?: string      // канонический JSON (всегда пишем рядом; имя можно переопределить)
  profilesDir?: string
}) {
  const { byId: rulesById } = loadRules(opts.profile, opts.profilesDir)

  // Нормализуем пути вывода → <repo>/dist для относительных
  const OUT_DIR = path.join(REPO_ROOT, 'dist')
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const toDist = (p: string | undefined, fallbackName: string) =>
    p && path.isAbsolute(p) ? p : path.join(OUT_DIR, path.basename(p || fallbackName))

  const outMdPath = toDist(opts.outMd, 'review.md')
  const outJsonPath = toDist(opts.outJson || 'review.json', 'review.json')

  // Читаем unified diff
  const diffPath = path.resolve(opts.diff)
  const diff = fs.readFileSync(diffPath, 'utf8')
  const files = parseUnifiedDiff(diff)

  const findings: ReviewFinding[] = []

  for (const f of files) {
    for (const h of f.hunks) {
      for (const add of h.added) {
        const text = add.text

        // style.no-todo-comment
        if (/^\s*\/\/\s*TODO\b/i.test(text) || /\/\*\s*TODO[\s:*]/i.test(text)) {
          const ruleId = 'style.no-todo-comment'
          const locator = `L${add.line}`
          const meta = metaFor(ruleId, rulesById)
          const first = text.trim()

          findings.push({
            rule: ruleId,
            area: meta.area,
            severity: meta.severity,
            file: f.filePath,
            locator,
            finding: [`[${locator}] TODO comment found: ${first}`],
            why: 'Inline TODOs get stale and hide tech debt.',
            suggestion: 'Replace with a link to a tracked ticket (issue/ID) and remove the inline TODO.',
            fingerprint: makeFingerprint(ruleId, f.filePath, locator, first),
          })
        }

        // arch.modular-boundaries
        if (
          /\bfrom\s+['"]feature-[^'"]+\/internal(?:\/|['"])/i.test(text) ||
          /import\s+[^;]*['"]feature-[^'"]+\/internal(?:\/|['"])/i.test(text)
        ) {
          const ruleId = 'arch.modular-boundaries'
          const locator = `L${add.line}`
          const meta = metaFor(ruleId, rulesById)
          const first = text.trim()

          findings.push({
            rule: ruleId,
            area: meta.area,
            severity: meta.severity,
            file: f.filePath,
            locator,
            finding: [`[${locator}] Cross-feature internal import: ${first}`],
            why: 'Features must not import each other directly; this couples internals.',
            suggestion: 'Use a shared adapter/port or the feature public API (e.g., feature-b/public-api).',
            fingerprint: makeFingerprint(ruleId, f.filePath, locator, first),
          })
        }
      }
    }
  }

  const review: ReviewJson = {
    ai_review: {
      version: 1,
      run_id: `run_${Date.now()}`,
      findings,
    },
  }

  // 1) Пишем канонический JSON
  ensureDirForFile(outJsonPath)
  fs.writeFileSync(outJsonPath, JSON.stringify(review, null, 2))

  // 2) Пишем транспортный Markdown с JSON-блоком (на случай «ИИ вернул текст»)
  const mdPayload =
    `<!-- SENTINEL:DUAL:JSON -->\n` +
    '```json\n' +
    JSON.stringify(review, null, 2) +
    '\n```\n' +
    `<!-- SENTINEL:DUAL:JSON:END -->\n`

  ensureDirForFile(outMdPath)
  fs.writeFileSync(outMdPath, mdPayload)

  console.log(`[review] wrote ${path.relative(REPO_ROOT, outJsonPath)} & ${path.relative(REPO_ROOT, outMdPath)} (${findings.length} findings)`)
}
