import { Command } from 'commander'
import { buildContextCLI } from './context.js'
import { runReviewCLI } from './review.js'
import { renderHtmlCLI } from './cmd/render-html.js'
import { type RenderOptions, type SeverityMap, type ReviewJson, renderMarkdown } from '@sentinel/core'
import fs from 'node:fs'

const program = new Command()

program
  .name('sentinel')
  .description('Sentinel AI CLI')

program
  .command('build-context')
  .option('--profile <profile>', 'profile', 'frontend')
  .option('--profiles-dir <dir>', 'override profiles dir')
  .option('--out <outFile>', 'output file (repo-root relative)')
  .action(async (opts) => {
    await buildContextCLI({ ...opts })
  })

program
  .command('review')
  .requiredOption('--diff <path>', 'unified diff file')
  .option('--profile <profile>', 'profile', 'frontend')
  .option('--profiles-dir <dir>', 'override profiles dir')
  .option('--provider <name>', 'provider: local|mock', 'local')
  .option('--out-md <path>', 'transport markdown (with json block)', 'review.md')
  .option('--out-json <path>', 'canonical json file', 'review.json')
  .action(async (opts) => {
    await runReviewCLI({
      diff: opts.diff,
      profile: opts.profile,
      profilesDir: opts.profilesDir,
      provider: opts.provider,
      outMd: opts['outMd'] || opts.outMd,
      outJson: opts['outJson'] || opts.outJson,
    })
  })

  program
  .command('render-md')
  .requiredOption('--in <path>', 'input review.json')
  .requiredOption('--out <path>', 'output review.md')
  .option('--template <path>', 'path to custom .hbs-like template')
  .option('--severity-map <path>', 'path to severity map json')
  .action((opts) => {
    const raw = JSON.parse(fs.readFileSync(opts.in, 'utf8')) as ReviewJson;
    const findings = raw.ai_review?.findings ?? [];

    const ropts: RenderOptions = {};
    if (opts.template && fs.existsSync(opts.template)) {
      ropts.template = fs.readFileSync(opts.template, 'utf8');
    }
    if (opts['severityMap'] && fs.existsSync(opts['severityMap'])) {
      ropts.severityMap = JSON.parse(fs.readFileSync(opts['severityMap'],'utf8')) as SeverityMap;
    }

    const md = renderMarkdown(findings, ropts);
    fs.mkdirSync(require('node:path').dirname(opts.out), { recursive: true });
    fs.writeFileSync(opts.out, md);
    console.log(`[render-md] wrote ${opts.out}`);
  });

program.parseAsync();

program
  .command('render-html')
  .requiredOption('--in <path>', 'input review.json')
  .option('--out <path>', 'output review.html', 'dist/review.html')
  .action(async (opts) => {
    await renderHtmlCLI({ inFile: opts.in, outFile: opts.out })
  })

program.parseAsync()
