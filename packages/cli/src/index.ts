// packages/cli/src/index.ts
import { Command } from 'commander'
import fs from 'node:fs'
import path from 'node:path'

import { buildContextCLI } from './context'
import { runReviewCLI } from './review'
import { renderHtmlCLI } from './cmd/render-html'

import {
  renderMarkdown,
  type RenderOptions,
  type SeverityMap,
  type ReviewJson,
} from '@sentinel/core'
import { initProfileCLI } from './cmd/init-profile'

const program = new Command()

program
  .name('sentinel')
  .description('Sentinel AI CLI')

// ──────────────────────────────────────────────────────────────────────────────
// build-context
// ──────────────────────────────────────────────────────────────────────────────
program
  .command('build-context')
  .option('--profile <profile>', 'profile', 'frontend')
  .option('--profiles-dir <dir>', 'override profiles dir')
  .option('--out <outFile>', 'output file (repo-root relative)')
  .action(async (opts) => {
    await buildContextCLI({ ...opts })
  })

  // ──────────────────────────────────────────────────────────────────────────────
  // init-profile
  // ──────────────────────────────────────────────────────────────────────────────
  program
  .command('init-profile')
  .argument('<name>', 'profile name (e.g. frontend-company-x)')
  .option('--out-dir <dir>', 'profiles root (default: packages/profiles)')
  .option('--force', 'overwrite existing files', false)
  .option('--with-adr', 'create docs/adr with a sample', false)
  .action(async (name, opts) => {
    await initProfileCLI({ name, outDir: opts.outDir, force: !!opts.force, withAdr: !!opts.withAdr })
  })

// ──────────────────────────────────────────────────────────────────────────────
// review
// ──────────────────────────────────────────────────────────────────────────────
program
  .command('review')
  .requiredOption('--diff <path>', 'unified diff file')
  .option('--profile <profile>', 'profile', 'frontend')
  .option('--profiles-dir <dir>', 'override profiles dir')
  .option('--provider <name>', 'provider: local|mock', 'local')
  .option('--out-md <path>', 'transport markdown (with json block)', 'review.md')
  .option('--out-json <path>', 'canonical json file', 'review.json')
  .option('--fail-on <severity>', 'fail on severity: major|critical (optional)')
  .option('--max-comments <n>', 'limit number of findings in output', (v) => Number(v), undefined)
  .action(async (opts) => {
    await runReviewCLI({
      diff: opts.diff,
      profile: opts.profile,
      profilesDir: opts.profilesDir,
      provider: opts.provider,
      outMd: opts.outMd,
      outJson: opts.outJson,
      // дополнительные опции (если реализованы в runReviewCLI)
      failOn: opts.failOn as 'major' | 'critical' | undefined,
      maxComments: typeof opts.maxComments === 'number' && Number.isFinite(opts.maxComments)
        ? opts.maxComments
        : undefined,
    })
  })

// ──────────────────────────────────────────────────────────────────────────────
// render-md
// ──────────────────────────────────────────────────────────────────────────────
program
  .command('render-md')
  .requiredOption('--in <path>', 'input review.json')
  .requiredOption('--out <path>', 'output review.md')
  .option('--template <path>', 'path to custom .hbs-like template')
  .option('--severity-map <path>', 'path to severity map json')
  .action((opts) => {
    const raw = JSON.parse(fs.readFileSync(opts.in, 'utf8')) as ReviewJson
    const findings = raw.ai_review?.findings ?? []

    const ropts: RenderOptions = {}
    if (opts.template && fs.existsSync(opts.template)) {
      ropts.template = fs.readFileSync(opts.template, 'utf8')
    }
    // commander делает camelCase: --severity-map -> opts.severityMap
    const sevMapPath = opts.severityMap || opts['severity-map']
    if (sevMapPath && fs.existsSync(sevMapPath)) {
      ropts.severityMap = JSON.parse(fs.readFileSync(sevMapPath, 'utf8')) as SeverityMap
    }

    const md = renderMarkdown(findings, ropts)
    fs.mkdirSync(path.dirname(opts.out), { recursive: true })
    fs.writeFileSync(opts.out, md)
    console.log(`[render-md] wrote ${opts.out}`)
  })

// ──────────────────────────────────────────────────────────────────────────────
// render-html
// ──────────────────────────────────────────────────────────────────────────────
program
  .command('render-html')
  .requiredOption('--in <path>', 'input review.json')
  .option('--out <path>', 'output review.html', 'dist/review.html')
  .action(async (opts) => {
    await renderHtmlCLI({ inFile: opts.in, outFile: opts.out })
  })

program.parseAsync()
