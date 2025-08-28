#!/usr/bin/env node
import { Command } from 'commander'
import { buildContextCLI } from './context.js'
import { runReviewCLI } from './review.js'

const program = new Command()

program
  .name('sentinel')
  .description('Sentinel AI — CLI for code review automation')
  .version('0.1.0')

// Build context command
program
  .command('build-context')
  .description('Build AI context (handbook + rules + ADR) into dist/ai-review-context.md')
  .option('--profile <profile>', 'Profile to use (default: frontend)', 'frontend')
  .option('--out <outFile>', 'Output file (default: dist/ai-review-context.md)')
  .action(async (opts) => {
    await buildContextCLI()
  })

// Review command
program
  .command('review')
  .description('Run AI review on a unified diff')
  .requiredOption('--diff <file>', 'Unified diff file to review')
  .option('--profile <profile>', 'Profile to use (default: frontend)', 'frontend')
  .option('--out-json <file>', 'Output findings JSON file', 'review.json')
  .option('--out-md <file>', 'Output findings Markdown file', 'review.md')
  .action(async (opts) => {
    await runReviewCLI(opts)
  })

program.parseAsync(process.argv).catch(err => {
  console.error(err)
  process.exit(1)
})
