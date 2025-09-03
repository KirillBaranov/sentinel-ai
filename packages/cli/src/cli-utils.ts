import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { bold, cyan, dim, green, red, yellow } from 'colorette'
import type { Severity } from '@sentinel/core'

type AnalyticsRcLike = {
  analytics?: {
    enabled?: boolean
    outDir?: string
  }
}

/** ────────────────────────────────────────────────────────────────────────────
 *  FS helpers
 *  ──────────────────────────────────────────────────────────────────────────── */
export function ensureDirForFile(p: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true })
}

/** Resolve a (possibly relative) path against repo root */
export function resolveRepoPath(repoRoot: string, p: string) {
  return path.isAbsolute(p) ? p : path.join(repoRoot, p)
}

/** Make file:// link for pretty output */
export const linkifyFile = (absPath: string) => pathToFileURL(absPath).href

/** Human friendly sizes/tokens */
export const formatBytes = (n: number) =>
  n < 1024 ? `${n} B`
  : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB`
  : `${(n / 1024 / 1024).toFixed(2)} MB`

/** Safe JSON helpers */
export function readJsonSync<T = unknown>(file: string): T {
  const raw = fs.readFileSync(file, 'utf8')
  return JSON.parse(raw) as T
}
export function writeJsonSync(file: string, data: unknown) {
  ensureDirForFile(file)
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
}

/** Assert a file exists (throws a clear error) */
export function assertFileExists(absPath: string, label = 'file') {
  if (!fs.existsSync(absPath)) {
    throw new Error(`[sentinel] ${label} not found at ${absPath}`)
  }
}

/** Pretty rel + file link for logs */
export function prettyRelLink(repoRoot: string, absPath: string) {
  return `${dim(path.relative(repoRoot, absPath))} ${cyan('→')} ${dim(linkifyFile(absPath))}`
}

/** ────────────────────────────────────────────────────────────────────────────
 *  Repo root detection (stable for monorepos)
 *  ────────────────────────────────────────────────────────────────────────────
 *  Rules:
 *   - If SENTINEL_REPO_ROOT is set and exists → use it
 *   - Else walk up from `start` until you find .git or pnpm-workspace.yaml
 *   - If not found, fall back to `start` (no surprises)
 */
export function findRepoRoot(start = process.cwd()): string {
  const envRoot = process.env.SENTINEL_REPO_ROOT
  if (envRoot && fs.existsSync(envRoot)) {
    return path.resolve(envRoot)
  }

  let dir = path.resolve(start)
  while (true) {
    const isGitRoot  = fs.existsSync(path.join(dir, '.git'))
    const isPnpmRoot = fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))
    if (isGitRoot || isPnpmRoot) return dir

    const parent = path.dirname(dir)
    if (parent === dir) {
      // reached FS root — fallback to original start
      return path.resolve(start)
    }
    dir = parent
  }
}

/** ────────────────────────────────────────────────────────────────────────────
 *  Pretty console helpers (consistent UX)
 *  ──────────────────────────────────────────────────────────────────────────── */
export const ok   = (msg: string) => console.log(green('✔ ') + msg)
export const info = (msg: string) => console.log(cyan('ℹ ') + msg)
export const warn = (msg: string) => console.warn(yellow('▲ ') + msg)
export const fail = (msg: string) => console.error(red('✖ ') + msg)

/** ────────────────────────────────────────────────────────────────────────────
 *  Severity helpers (shared with review)
 *  ──────────────────────────────────────────────────────────────────────────── */
export const sevRank: Record<Severity, number> = {
  critical: 3, major: 2, minor: 1, info: 0,
}

export function maxSeverity(findings: { severity: Severity }[]): Severity | null {
  let max: Severity | null = null
  for (const f of findings) if (!max || sevRank[f.severity] > sevRank[max]) max = f.severity
  return max
}

export function countBySeverity(findings: { severity: Severity }[]) {
  const c = { critical: 0, major: 0, minor: 0, info: 0 }
  for (const f of findings) c[f.severity]++
  return c
}

/** ────────────────────────────────────────────────────────────────────────────
 *  Unified summaries
 *  ──────────────────────────────────────────────────────────────────────────── */

/** Print nice summary for review run */
export function printReviewSummary(args: {
  repoRoot: string
  providerLabel: string
  profile: string
  outJsonPath: string
  outMdPath: string
  findings: { severity: Severity }[]
  exit: { mode: 'legacy' | 'threshold' | 'none'; exitCode: number; threshold?: Severity; top?: Severity | null }
}) {
  const { repoRoot, providerLabel, profile, outJsonPath, outMdPath, findings, exit } = args
  const total = findings?.length ?? 0
  const counts = countBySeverity(findings ?? [])
  const top = maxSeverity(findings ?? [])

  console.log('')
  console.log(bold('Review summary'))
  console.log('  ' + cyan('provider: ') + providerLabel)
  console.log('  ' + cyan('profile:  ') + profile)
  console.log('  ' + cyan('outputs:  ')
    + `${dim(path.relative(repoRoot, outJsonPath))}, `
    + `${dim(path.relative(repoRoot, outMdPath))}`)
  console.log('  ' + cyan('findings: ')
    + `${total} `
    + dim(`(critical ${counts.critical}, major ${counts.major}, minor ${counts.minor}, info ${counts.info})`))
  console.log('  ' + cyan('max severity: ')
    + (top
      ? (top === 'critical' ? red('critical') : top === 'major' ? yellow('major') : green(top))
      : green('none')))

  // Exit policy line
  let line = ''
  if (exit.mode === 'none') {
    line = green('exit 0') + dim(' — failOn=none (never fail)')
  } else if (exit.mode === 'threshold') {
    const shouldFail = exit.exitCode !== 0
    line = (shouldFail ? red('exit 1') : green('exit 0'))
         + dim(` — failOn=${exit.threshold}, max=${exit.top ?? 'none'}`)
  } else {
    // legacy
    line = (exit.exitCode ? yellow(`exit ${exit.exitCode}`) : green('exit 0'))
         + dim(' — legacy policy (critical→20, major→10, else 0)')
  }
  console.log('  ' + cyan('exit policy: ') + line)
}

/** Print nice summary for context build */
export function printContextSummary(args: {
  repoRoot: string
  profile: string
  profilesRootLabel: string
  outFile: string
  handbookCount: number
  adrCount: number
  hasBoundaries: boolean
  bytes: number
  tokens: number
  checksum: string
}) {
  const { repoRoot, profile, profilesRootLabel, outFile, handbookCount, adrCount, hasBoundaries, bytes, tokens, checksum } = args
  console.log('')
  console.log(bold('Context summary'))
  console.log('  ' + cyan('profile:  ') + profile)
  console.log('  ' + cyan('profiles: ') + profilesRootLabel)
  console.log('  ' + cyan('output:   ') + `${path.relative(repoRoot, outFile)} → ${linkifyFile(outFile)}`)
  console.log('  ' + cyan('sections: ') + `handbook ${handbookCount}, adr ${adrCount}, boundaries ${hasBoundaries ? 'yes' : 'no'}`)
  console.log('  ' + cyan('size:     ') + `${bytes} bytes, ~${tokens} tokens`)
  console.log('  ' + cyan('checksum: ') + checksum)
}

/** Print nice summary for render → Markdown */
export function printRenderSummaryMarkdown(args: {
  repoRoot: string
  inFile: string
  outFile: string
  findingsCount?: number
}) {
  const { repoRoot, inFile, outFile, findingsCount } = args
  console.log('')
  console.log(bold('Render (Markdown) summary'))
  console.log('  ' + cyan('input:   ') + `${dim(path.relative(repoRoot, inFile))} ${cyan('→')} ${dim(linkifyFile(inFile))}`)
  console.log('  ' + cyan('output:  ') + `${dim(path.relative(repoRoot, outFile))} ${cyan('→')} ${dim(linkifyFile(outFile))}`)
  if (typeof findingsCount === 'number') {
    console.log('  ' + cyan('findings: ') + findingsCount)
  }
  ok('Markdown written')
}

/** Print nice summary for render → HTML */
export function printRenderSummaryHtml(args: {
  repoRoot: string
  inFile: string
  outFile: string
}) {
  const { repoRoot, inFile, outFile } = args
  console.log('')
  console.log(bold('Render (HTML) summary'))
  console.log('  ' + cyan('input:   ') + `${dim(path.relative(repoRoot, inFile))} ${cyan('→')} ${dim(linkifyFile(inFile))}`)
  console.log('  ' + cyan('output:  ') + `${dim(path.relative(repoRoot, outFile))} ${cyan('→')} ${dim(linkifyFile(outFile))}`)
  ok('HTML written')
}

/** Print concise summary for init-profile */
export function printInitSummary(args: {
  repoRoot: string
  profile: string
  root: string          // абсолютный путь к созданному профилю (profiles/<name>)
  adr: boolean
  created: string[]     // абсолютные пути созданных файлов
  skipped: string[]     // абсолютные пути пропущенных (существующих) файлов
}) {
  const { repoRoot, profile, root, adr, created, skipped } = args

  console.log('')
  console.log(bold('Init profile summary'))
  console.log('  ' + cyan('profile: ') + profile)
  console.log('  ' + cyan('root:    ') + path.relative(repoRoot, root))
  console.log('  ' + cyan('adr:     ') + (adr ? 'yes' : 'no'))

  if (created.length) {
    ok('Created:')
    for (const f of created) {
      const rel = path.relative(repoRoot, f)
      console.log('   • ' + dim(rel) + ' ' + cyan('→') + ' ' + dim(linkifyFile(f)))
    }
  }

  if (skipped.length) {
    warn('Skipped (already exists):')
    for (const f of skipped) {
      const rel = path.relative(repoRoot, f)
      console.log('   • ' + dim(rel))
    }
  }
}

export function printInitNextSteps(args: {
  repoRoot: string
  profile: string
  root: string        // абсолютный путь к созданному профилю (profiles/<name>)
  baseRoot: string    // корень каталога профилей (packages/profiles или переопределённый)
}) {
  const { repoRoot, profile, root, baseRoot } = args
  const relHandbook = path.relative(repoRoot, path.join(root, 'docs/handbook'))
  const relRules    = path.relative(repoRoot, path.join(root, 'docs/rules/rules.json'))
  const relProfilesRoot = path.relative(repoRoot, baseRoot)

  console.log('')
  console.log(bold('Next steps'))
  console.log('  - Edit ' + yellow(relHandbook) + ' to reflect your team agreements.')
  console.log('  - Adjust ' + yellow(relRules) + ' severities/areas to fit your policy.')
  console.log('  - Try a dry run:\n    ' +
    dim(`pnpm --filter @sentinel/cli exec tsx src/index.ts review ` +
        `--diff ../../fixtures/changes.diff ` +
        `--profile ${profile} ` +
        `--profiles-dir ${relProfilesRoot} ` +
        `--provider local ` +
        `--fail-on none`))
}

/** Resolve analytics out directory and filename pattern (byDay|byRun) from repo root */
export function resolveAnalyticsOut(args: {
  repoRoot: string
  rc?: AnalyticsRcLike
  runId?: string
}) {
  const { repoRoot, rc, runId } = args

  // enabled: rc or env
  const enabled =
    !!rc?.analytics?.enabled ||
    process.env.SENTINEL_ANALYTICS === '1' ||
    process.env.SENTINEL_ANALYTICS === 'true'

  // outDir: rc → env → default
  const outDirRaw =
    rc?.analytics?.outDir ||
    process.env.SENTINEL_ANALYTICS_DIR ||
    '.sentinel/analytics'

  const outDirAbs = resolveRepoPath(repoRoot, outDirRaw)

  // file mode: byDay | byRun (env switch; byDay по умолчанию)
  const mode =
    (process.env.SENTINEL_ANALYTICS_FILE_MODE === 'byRun' ? 'byRun' : 'byDay') as
      | 'byDay'
      | 'byRun'

  // current file path (best-effort)
  const day = new Date().toISOString().slice(0, 10)
  const fileAbs =
    mode === 'byRun' && runId
      ? path.join(outDirAbs, `events.run.${runId}.jsonl`)
      : path.join(outDirAbs, `events.${day}.jsonl`)

  return { enabled, outDirAbs, mode, fileAbs }
}

/** Pretty print where analytics will be written */
export function printAnalyticsSummary(args: {
  repoRoot: string
  runId?: string
  diag: {
    enabled: boolean
    mode: 'byDay' | 'byRun'
    outDir?: string
    currentFile?: string
    privacy: 'team' | 'detailed'
  }
}) {
  const { repoRoot, runId, diag } = args
  console.log('')
  console.log(bold('Analytics summary'))

  if (!diag.enabled) {
    console.log('  ' + cyan('status:   ') + dim('disabled (rc/env)'))
    return
  }

  console.log('  ' + cyan('status:   ') + green('enabled'))
  console.log('  ' + cyan('mode:     ') + diag.mode)
  console.log('  ' + cyan('privacy:  ') + diag.privacy)
  if (runId) {
    console.log('  ' + cyan('run_id:   ') + dim(runId))
  }

  if (diag.outDir) {
    console.log(
      '  ' +
        cyan('directory:') +
        ` ${dim(path.relative(repoRoot, diag.outDir))} ${cyan('→')} ${dim(
          linkifyFile(diag.outDir)
        )}`
    )
  }

  if (diag.currentFile) {
    console.log(
      '  ' +
        cyan('file:     ') +
        ` ${dim(path.relative(repoRoot, diag.currentFile))} ${cyan('→')} ${dim(
          linkifyFile(diag.currentFile)
        )}`
    )
  }
}
