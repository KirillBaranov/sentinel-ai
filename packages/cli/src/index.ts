import fs from 'node:fs'
import path from 'node:path'
import { Command } from 'commander'
import { bold, dim } from 'colorette'

import { buildContextCLI } from './context'
import { runReviewCLI } from './review'
import { renderHtmlCLI } from './cmd/render-html'
import { initProfileCLI } from './cmd/init-profile'
import { loadConfig } from './config'

import {
  findRepoRoot,
  fail,
  printRenderSummaryMarkdown,
} from './cli-utils'

import {
  type RenderOptions,
  type SeverityMap,
  renderMarkdown,
} from '@sentinel/core'

// Local type definition for ReviewJson
interface ReviewJson {
  ai_review: {
    version: 1
    run_id: string
    findings: Array<{
      rule: string
      area: string
      severity: 'critical' | 'major' | 'minor' | 'info'
      file: string
      locator: string
      finding: string[]
      why: string
      suggestion: string
      fingerprint: string
    }>
  }
}

// ────────────────────────────────────────────────────────────────────────────────
// Repo root (.git | pnpm-workspace.yaml | fallback)
// ────────────────────────────────────────────────────────────────────────────────
const REPO_ROOT = findRepoRoot()

// ────────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────────
function hintProfileResolution(profile: string, profilesDir?: string) {
  const candidates = [
    '`profiles/<name>`',
    '`packages/profiles/<name>`',
    profilesDir ? `\`${profilesDir}/${profile}\`` : null,
  ].filter(Boolean).join(', ')
  return `Profile "${profile}" not found. Looked in: ${candidates}.
Try: ${bold('sentinel init-profile --name ' + profile)} or pass ${bold('--profiles-dir')} to override root.`
}

// ────────────────────────────────────────────────────────────────────────────────
const program = new Command()
  .name('sentinel')
  .description(`${bold('Sentinel AI CLI')} — code review with profiles & providers`)
  .version('0.1.0')

program.showHelpAfterError()
program.showSuggestionAfterError()

// build-context
program
  .command('build-context')
  .description('Build AI review context (handbook + rules + ADR) into dist/ai-review-context.md')
  .option('-p, --profile <profile>', 'profile name')
  .option('--profiles-dir <dir>', 'override profiles root')
  .option('-o, --out <path>', 'output file (repo-root relative)')
  .action(async (opts) => {
    try {
      // CLI → overrides; остальное подтащим из RC/ENV/Defaults
      const cfg = loadConfig({
        defaultProfile: opts.profile,
        profilesDir: opts.profilesDir,
      })

      await buildContextCLI({
        profile: cfg.defaultProfile!,
        profilesDir: cfg.profilesDir,
        out: opts.out
          ? (path.isAbsolute(opts.out) ? opts.out : path.join(REPO_ROOT, opts.out))
          : undefined,
        includeADR: cfg.context?.includeADR,
        includeBoundaries: cfg.context?.includeBoundaries,
        maxBytes: cfg.context?.maxBytes,
        maxApproxTokens: cfg.context?.maxApproxTokens,
      } as any)
      // buildContextCLI печатает сводку сам
    } catch (e: any) {
      if (/not found: .+rules\.json/.test(String(e?.message))) {
        fail(e.message)
        const cfg = loadConfig({ defaultProfile: opts.profile, profilesDir: opts.profilesDir })
        console.log('\n' + hintProfileResolution(cfg.defaultProfile!, cfg.profilesDir))
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
  .requiredOption('-d, --diff <path>', 'unified diff file')
  .option('-p, --profile <profile>', 'profile name')
  .option('--profiles-dir <dir>', 'override profiles root')
  .option('--provider <name>', 'provider: local|mock|openai')
  .option('--out-md <path>', 'transport Markdown (.md) with fenced JSON')
  .option('--out-json <path>', 'canonical review JSON')
  .option('--fail-on <level>', 'none|major|critical (exit policy)')
  .option('--max-comments <n>', 'cap number of findings')
  .option('--debug', 'verbose debug logs', false)
  .action(async (opts) => {
    // Конфиг c учётом CLI-override'ов (не передаём undefined полей)
    const outputOverrides: Record<string, string> = {}
    if (typeof opts.outMd === 'string') outputOverrides.mdName = opts.outMd
    if (typeof opts.outJson === 'string') outputOverrides.jsonName = opts.outJson

    const cfg = loadConfig({
      defaultProfile: opts.profile,
      profilesDir: opts.profilesDir,
      provider: opts.provider,
      failOn: opts.failOn,
      maxComments:
        typeof opts.maxComments === 'string' ? Number(opts.maxComments) : opts.maxComments,
      output: Object.keys(outputOverrides).length ? outputOverrides : undefined,
    })

    const diff = opts.diff as string
    if (!diff) {
      fail('Missing --diff <path>')
      console.log(dim('Example: sentinel review --diff ../../fixtures/changes.diff'))
      process.exit(2)
    }

    try {
      const diffPath = path.isAbsolute(diff) ? diff : path.join(REPO_ROOT, diff)

      await runReviewCLI({
        diff: diffPath,
        profile: cfg.defaultProfile!,
        profilesDir: cfg.profilesDir,
        provider: cfg.provider,
        outMd: (() => {
          const name = cfg.output?.mdName ?? 'review.md'
          return path.isAbsolute(name) ? name : path.join(cfg.output?.dir ?? REPO_ROOT, name)
        })(),
        outJson: (() => {
          const name = cfg.output?.jsonName ?? 'review.json'
          return path.isAbsolute(name) ? name : path.join(cfg.output?.dir ?? REPO_ROOT, name)
        })(),
        failOn: cfg.failOn as any,
        maxComments: cfg.maxComments,
        debug: !!opts.debug,
      })
      // runReviewCLI печатает сводку и сам выставляет exit code
    } catch (e: any) {
      if (/Profile .* not found/.test(String(e?.message))) {
        fail(e.message)
        console.log(
          '\n' +
            hintProfileResolution(
              loadConfig({ defaultProfile: opts.profile }).defaultProfile!,
              opts.profilesDir
            )
        )
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
      fs.writeFileSync(outPath, md, 'utf8')

      printRenderSummaryMarkdown({
        repoRoot: REPO_ROOT,
        inFile: inPath,
        outFile: outPath,
        findingsCount: findings.length,
      })
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
    try {
      await initProfileCLI({
        name: opts.name,
        outDir: opts.outDir,
        force: !!opts.force,
        withAdr: !!opts.withAdr,
      })
      // initProfileCLI сам печатает summary и next steps
    } catch (e: any) {
      fail(String(e?.stack || e))
      process.exit(1)
    }
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
    } catch (e: any) {
      fail(String(e?.stack || e))
      process.exit(1)
    }
  })

program.addHelpText('afterAll', `
${dim('Config sources (priority high→low):')} CLI ${bold('>')} ENV ${bold('>')} .sentinelrc.json ${bold('>')} defaults
ENV vars: SENTINEL_PROFILE, SENTINEL_PROFILES_DIR, SENTINEL_PROVIDER, SENTINEL_OUT_DIR, SENTINEL_OUT_MD, SENTINEL_OUT_JSON, SENTINEL_FAIL_ON, SENTINEL_MAX_COMMENTS, SENTINEL_DEBUG
Repo root: ${dim(REPO_ROOT)}
`)

program.parseAsync().catch((e) => {
  fail(String(e?.stack || e))
  process.exit(1)
})
