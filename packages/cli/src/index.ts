import { Command } from 'commander'
import { buildContextCLI } from './context.js'
import { runReviewCLI } from './review.js'
import { renderMdCLI } from './cmd/render-md.js'
import { renderHtmlCLI } from './cmd/render-html.js'

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
  .option('--out <path>', 'output review.md', 'dist/review.human.md')
  .action(async (opts) => {
    await renderMdCLI({ inFile: opts.in, outFile: opts.out })
  })

program
  .command('render-html')
  .requiredOption('--in <path>', 'input review.json')
  .option('--out <path>', 'output review.html', 'dist/review.html')
  .action(async (opts) => {
    await renderHtmlCLI({ inFile: opts.in, outFile: opts.out })
  })

program.parseAsync()
