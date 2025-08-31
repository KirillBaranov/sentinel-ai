// packages/cli/src/cmd/init-profile.ts
import fs from 'node:fs'
import path from 'node:path'
import {
  findRepoRoot,
  printInitSummary,
  printInitNextSteps,
} from '../cli-utils.js'

const REPO_ROOT = findRepoRoot()

export type InitProfileOpts = {
  name: string                 // profile name, e.g. "frontend"
  outDir?: string              // root to place profiles, default: packages/profiles
  force?: boolean              // overwrite existing files
  withAdr?: boolean            // create docs/adr with a starter ADR
}

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true })
}

function writeFileIfMissing(filePath: string, content: string, force = false) {
  if (!force && fs.existsSync(filePath)) return false
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, content, 'utf8')
  return true
}

function tplRulesJson(name: string) {
  return JSON.stringify({
    version: 1,
    domain: name,
    metadata: { owner: `profiles/${name}`, createdAt: new Date().toISOString().slice(0, 10) },
    rules: [
      {
        id: 'arch.modular-boundaries',
        area: 'Architecture',
        severity: 'critical',
        description: 'Enforce module boundaries; no cross-feature imports without adapter.',
        link: 'docs/handbook/architecture.md#module-boundaries',
        examples: { bad: ['feature-a imports feature-b/internal'], good: ['feature-a -> shared/ports adapter -> feature-b'] },
        scope: ['changed', 'project'],
        trigger: { type: 'hybrid', signals: ['import-graph', 'path-alias'] },
        status: 'active',
        version: 1,
        ask_feedback: true,
      },
      {
        id: 'style.no-todo-comment',
        area: 'DX',
        severity: 'minor',
        description: 'Avoid TODO comments in code; track via issue links instead.',
        link: 'docs/handbook/style.md#no-todo',
        examples: { bad: ['// TODO: remove later'], good: ['// see ISSUE-123 for follow-up'] },
        scope: ['changed'],
        trigger: { type: 'pattern', signals: ['added-line:TODO'] },
        status: 'active',
        version: 1,
      },
    ],
  }, null, 2) + '\n'
}

function tplBoundariesJson() {
  return JSON.stringify({
    layers: [
      { name: 'app',     path: 'src/app/**',        index: 3 },
      { name: 'feature', path: 'src/features/*/**', index: 2 },
      { name: 'shared',  path: 'src/shared/**',     index: 1 },
    ],
    forbidden: [
      {
        rule: 'feature-to-feature-internal',
        from:  { glob: 'src/features/*/**' },
        to:    { glob: 'src/features/*/internal/**' },
        allowVia: ['src/shared/ports/**'],
        explain: 'Features must not import other features’ internal modules directly; use shared ports/adapters.',
      },
    ],
  }, null, 2) + '\n'
}

const tplArchitecture = `# Architecture Handbook

## Module boundaries
Features must not import each other directly. Use a shared port/adapter.

**Allowed**
- \`feature-a\` → \`shared/ports/<adapter>.ts\` → \`feature-b/public-api.ts\`

**Forbidden**
- \`feature-a/*\` → \`feature-b/internal/*\`

## Public vs Internal
- \`public-api.ts\` — everything importable from outside.
- \`internal/*\` — private; external imports are forbidden.

## Layers
- \`src/shared/**\` (1)
- \`src/features/*/**\` (2)
- \`src/app/**\` (3)

**Rule:** higher index may depend on lower, not vice versa.
`

const tplStyle = `# Style Handbook

## No TODO comments
Replace inline TODOs with a link to a tracked ticket.

**Bad**
\`\`\`ts
// TODO: remove after refactor
\`\`\`

**Good**
\`\`\`ts
// See ISSUE-123
\`\`\`
`

const tplTesting = `# Testing Handbook

- Public API changes must have unit tests.
- Prefer small, focused tests.
- Keep tests deterministic.
`

const tplReadme = (name: string) => `# ${name} Profile

This profile contains:
- docs/handbook/*.md
- docs/rules/rules.json
- docs/rules/boundaries.json
- docs/adr (optional)

## Usage

Build context (optional, to inspect the full knowledge-pack for AI):
\`\`\`bash
pnpm --filter @sentinel/cli exec tsx src/index.ts build-context --profile ${name}
\`\`\`

Run review against a diff:
\`\`\`bash
pnpm --filter @sentinel/cli exec tsx src/index.ts review \\
  --diff ../../fixtures/changes.diff \\
  --profile ${name} \\
  --profiles-dir packages/profiles \\
  --provider local \\
  --out-md review.md --out-json review.json
\`\`\`
`

export async function initProfileCLI(opts: InitProfileOpts) {
  const name = opts.name.trim()
  if (!name) throw new Error('Profile name is required')

  const baseRoot = opts.outDir
    ? (path.isAbsolute(opts.outDir) ? opts.outDir : path.join(REPO_ROOT, opts.outDir))
    : path.join(REPO_ROOT, 'packages', 'profiles')

  const root = path.join(baseRoot, name)

  const created: string[] = []
  const skipped: string[] = []

  const files: Array<[string, string]> = [
    [path.join(root, 'README.md'), tplReadme(name)],
    [path.join(root, 'docs', 'handbook', 'architecture.md'), tplArchitecture],
    [path.join(root, 'docs', 'handbook', 'style.md'),        tplStyle],
    [path.join(root, 'docs', 'handbook', 'testing.md'),      tplTesting],
    [path.join(root, 'docs', 'rules', 'rules.json'),         tplRulesJson(name)],
    [path.join(root, 'docs', 'rules', 'boundaries.json'),    tplBoundariesJson()],
  ]

  if (opts.withAdr) {
    files.push([
      path.join(root, 'docs', 'adr', '0001-record-architecture.md'),
`# ADR-0001: Record architecture decisions

- Date: ${new Date().toISOString().slice(0,10)}
- Status: accepted

Context / Decision / Consequences.
`
    ])
  }

  for (const [fp, content] of files) {
    const wrote = writeFileIfMissing(fp, content, !!opts.force)
    if (wrote) created.push(fp); else skipped.push(fp)
  }

  // красивые сводки в едином стиле
  printInitSummary({
    repoRoot: REPO_ROOT,
    profile: name,
    root,
    adr: !!opts.withAdr,
    created,
    skipped,
  })

  printInitNextSteps({
    repoRoot: REPO_ROOT,
    baseRoot,
    root,
    profile: name,
  })

  return { root, created, skipped }
}
