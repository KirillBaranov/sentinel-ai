// packages/cli/src/index.ts
import fs from 'node:fs'
import path from 'node:path'
import { Command } from 'commander'
import { bold, cyan, dim, green, red, yellow } from 'colorette'

import { buildContextCLI } from './context.js'
import { runReviewCLI } from './review.js'
import { renderHtmlCLI } from './cmd/render-html.js'
import { initProfileCLI } from './cmd/init-profile.js'

import {
  type RenderOptions,
  type SeverityMap,
  type ReviewJson,
  renderMarkdown,
} from '@sentinel/core'

import {
  // единые DX-утилиты
  findRepoRoot,
  ok, info, warn, fail,
} from './cli-utils.js'

// ────────────────────────────────────────────────────────────────────────────────
// Repo root (из общих утилит: .git | pnpm-workspace.yaml | top-level package.json)
// ────────────────────────────────────────────────────────────────────────────────
const REPO_ROOT = findRepoRoot()

// ────────────────────────────────────────────────────────────────────────────────
// RC loader (.sentinelrc.json) + ENV → plain object
// Priority: CLI > ENV > RC > defaults (merge late → early)
// ────────────────────────────────────────────────────────────────────────────────
type Rc = Partial<{
  profile: string
  profilesDir: string
  provider: string
  outMd: string
  outJson: string
  failOn: 'none' | 'major' | 'critical'
  maxComments: number
  diff: string
  debug: boolean
}>

function readJsonSafe(p: string): any | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null }
}

function loadRc(): Rc {
  const candidates = [
    path.join(REPO_ROOT, '.sentinelrc.json'),
    path.join(process.cwd(), '.sentinelrc.json'),
  ]
  let rc: Rc = {}
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      const data = readJsonSafe(c)
      if (data && typeof data === 'object') {
        rc = { ...rc, ...data }
      }
    }
  }

  const env: Rc = {
    profile: process.env.SENTINEL_PROFILE ?? rc.profile,
    profilesDir: process.env.SENTINEL_PROFILES_DIR ?? rc.profilesDir,
    provider: process.env.SENTINEL_PROVIDER ?? rc.provider,
    outMd: process.env.SENTINEL_OUT_MD ?? rc.outMd,
    outJson: process.env.SENTINEL_OUT_JSON ?? rc.outJson,
    failOn: (process.env.SENTINEL_FAIL_ON as any) ?? rc.failOn,
    maxComments: process.env.SENTINEL_MAX_COMMENTS
      ? Number(process.env.SENTINEL_MAX_COMMENTS)
      : rc.maxComments,
    diff: process.env.SENTINEL_DIFF ?? rc.diff,
    debug: process.env.SENTINEL_DEBUG ? process.env.SENTINEL_DEBUG === '1' : rc.debug,
  }
  return env
}

function pick<T>(cliVal: T | undefined, envVal: T | undefined, fallback: T): T {
  return (cliVal ?? envVal) ?? fallback
}

// ────────────────────────────────────────────────────────────────────────────────
// Pretty helpers (локальные обёртки остались — используют colorette)
// ────────────────────────────────────────────────────────────────────────────────
function hintProfileResolution(profile: string, profilesDir?: string) {
  const candidates = [
    '`profiles/<name>`',
    '`packages/profiles/<name>`',
    profilesDir ? `\`${profilesDir}/${profile}\`` : null,
  ].filter(Boolean).join(', ')
  return `Profile "${profile}" not found. Looked in: ${candidates}.
Try: ${bold('sentinel init-profile ' + profile)} or pass ${bold('--profiles-dir')} to override root.`
}

// ────────────────────────────────────────────────────────────────────────────────
// Commander setup
// ────────────────────────────────────────────────────────────────────────────────
const program = new Command()
  .name('sentinel')
  .description(`${bold('Sentinel AI CLI')} — code review with profiles & providers`)
  .version('0.1.0')

program.showHelpAfterError()
program.showSuggestionAfterError()

const rc = loadRc()

// build-context
program
  .command('build-context')
  .description('Build AI review context (handbook + rules + ADR) into dist/ai-review-context.md')
  .option('-p, --profile <profile>', 'profile name', rc.profile ?? 'frontend')
  .option('--profiles-dir <dir>', 'override profiles root', rc.profilesDir)
  .option('-o, --out <path>', 'output file (repo-root relative)', undefined)
  .action(async (opts) => {
    try {
      await buildContextCLI({
        profile: pick(opts.profile, rc.profile, 'frontend'),
        profilesDir: opts.profilesDir ?? rc.profilesDir,
        out: opts.out
          ? (path.isAbsolute(opts.out) ? opts.out : path.join(REPO_ROOT, opts.out))
          : undefined,
      } as any)
      ok(`Context built. See ${dim(path.join(REPO_ROOT, 'dist/ai-review-context.md'))}`)
    } catch (e: any) {
      if (/not found: .+rules\.json/.test(String(e?.message))) {
        fail(e.message)
        console.log('\n' + hintProfileResolution(pick(opts.profile, rc.profile, 'frontend'), opts.profilesDir ?? rc.profilesDir))
      } else {
        fail(String(e?.stack || e))
      }
      process.exit(1)
    }
  })

// review
program
  .command('review')
  .description('Run review (local/mock/openai), write JSON and transport Markdown with JSON block')
  .requiredOption('-d, --diff <path>', 'unified diff file', rc.diff)
  .option('-p, --profile <profile>', 'profile name', rc.profile ?? 'frontend')
  .option('--profiles-dir <dir>', 'override profiles root', rc.profilesDir)
  .option('--provider <name>', 'provider: local|mock|openai', rc.provider ?? 'local')
  .option('--out-md <path>', 'transport Markdown (.md) with fenced JSON', rc.outMd ?? 'review.md')
  .option('--out-json <path>', 'canonical review JSON', rc.outJson ?? 'review.json')
  .option('--fail-on <level>', 'none|major|critical (exit policy)', rc.failOn)
  .option('--max-comments <n>', 'cap number of findings', rc.maxComments)
  .option('--debug', 'verbose debug logs', rc.debug ?? false)
  .action(async (opts) => {
    const diff = pick<string | undefined>(opts.diff, rc.diff, undefined as any)
    if (!diff) {
      fail('Missing --diff <path>')
      console.log(dim('Example: sentinel review --diff ../../fixtures/changes.diff'))
      process.exit(2)
    }
    try {
      await runReviewCLI({
        diff: path.isAbsolute(diff) ? diff : path.join(REPO_ROOT, diff),
        profile: pick(opts.profile, rc.profile, 'frontend'),
        profilesDir: opts.profilesDir ?? rc.profilesDir,
        provider: pick(opts.provider, rc.provider, 'local'),
        outMd: (() => {
          const v = pick(opts.outMd, rc.outMd, 'review.md')
          return path.isAbsolute(v) ? v : path.join(REPO_ROOT, v)
        })(),
        outJson: (() => {
          const v = pick(opts.outJson, rc.outJson, 'review.json')
          return path.isAbsolute(v) ? v : path.join(REPO_ROOT, v)
        })(),
        failOn: opts.failOn ?? rc.failOn,
        maxComments: opts.maxComments ?? rc.maxComments,
        debug: !!opts.debug,
      })
      ok('Review finished.')
    } catch (e: any) {
      if (/Profile .* not found/.test(String(e?.message))) {
        fail(e.message)
        console.log('\n' + hintProfileResolution(pick(opts.profile, rc.profile, 'frontend'), opts.profilesDir ?? rc.profilesDir))
      } else {
        fail(String(e?.stack || e))
      }
      process.exit(1)
    }
  })

// render-md
program
  .command('render-md')
  .description('Render review.json → human-friendly Markdown (with optional template & severity map)')
  .requiredOption('--in <path>', 'input review.json')
  .requiredOption('--out <path>', 'output review.md')
  .option('--template <path>', 'custom template file')
  .option('--severity-map <path>', 'JSON remap of severity labels')
  .action((opts) => {
    try {
      const inPath  = path.isAbsolute(opts.in)  ? opts.in  : path.join(REPO_ROOT, opts.in)
      const outPath = path.isAbsolute(opts.out) ? opts.out : path.join(REPO_ROOT, opts.out)

      const raw = JSON.parse(fs.readFileSync(inPath, 'utf8')) as ReviewJson
      const findings = raw.ai_review?.findings ?? []

      const ropts: RenderOptions = {}
      if (opts.template) {
        const tpl = path.isAbsolute(opts.template) ? opts.template : path.join(REPO_ROOT, opts.template)
        if (fs.existsSync(tpl)) ropts.template = fs.readFileSync(tpl, 'utf8')
      }
      const sevPath = (opts as any)['severityMap'] || opts['severity-map']
      if (sevPath) {
        const sp = path.isAbsolute(sevPath) ? sevPath : path.join(REPO_ROOT, sevPath)
        if (fs.existsSync(sp)) ropts.severityMap = JSON.parse(fs.readFileSync(sp, 'utf8')) as SeverityMap
      }

      const md = renderMarkdown(findings, ropts)
      fs.mkdirSync(path.dirname(outPath), { recursive: true })
      fs.writeFileSync(outPath, md)
      ok(`Markdown written → ${dim(outPath)}`)
    } catch (e: any) {
      fail(String(e?.stack || e))
      process.exit(1)
    }
  })

// init-profile
program
  .command('init-profile')
  .description('Scaffold a new review profile (handbook + rules + boundaries [+ ADR])')
  .requiredOption('--name <name>', 'profile name (e.g. frontend)')
  .option('--out-dir <dir>', 'profiles root (default: packages/profiles)')
  .option('--force', 'overwrite existing files', false)
  .option('--with-adr', 'create docs/adr starter file', false)
  .action(async (opts) => {
    await initProfileCLI({
      name: opts.name,
      outDir: opts.outDir,
      force: !!opts.force,
      withAdr: !!opts.withAdr,
    })
  })

// render-html
program
  .command('render-html')
  .description('Render review.json → HTML report')
  .requiredOption('--in <path>', 'input review.json')
  .option('--out <path>', 'output review.html', 'dist/review.html')
  .action(async (opts) => {
    try {
      const inPath  = path.isAbsolute(opts.in)  ? opts.in  : path.join(REPO_ROOT, opts.in)
      const outPath = path.isAbsolute(opts.out) ? opts.out : path.join(REPO_ROOT, opts.out)

      await renderHtmlCLI({ inFile: inPath, outFile: outPath })
      ok(`HTML written → ${dim(outPath)}`)
    } catch (e: any) {
      fail(String(e?.stack || e))
      process.exit(1)
    }
  })

// Global help footer
program.addHelpText('afterAll', `
${dim('Config sources (priority high→low):')} CLI ${bold('>')} ENV ${bold('>')} .sentinelrc.json ${bold('>')} defaults
ENV vars: SENTINEL_PROFILE, SENTINEL_PROFILES_DIR, SENTINEL_PROVIDER, SENTINEL_OUT_MD, SENTINEL_OUT_JSON, SENTINEL_FAIL_ON, SENTINEL_MAX_COMMENTS, SENTINEL_DIFF, SENTINEL_DEBUG
Repo root: ${dim(REPO_ROOT)}
`)

program.parseAsync().catch((e) => {
  fail(String(e?.stack || e))
  process.exit(1)
})
