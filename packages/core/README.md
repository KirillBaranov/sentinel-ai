# @sentinel/core

Core utilities for **Sentinel AI** — parsing diffs, running static checks, and rendering findings.  
This package is framework-agnostic and contains only deterministic logic (no LLM calls).

## Features
- Parse unified diffs (`git diff` style) into normalized structures.
- Run static heuristics against a `rules.json` + `boundaries.json` profile.
- Generate stable fingerprints for findings.
- Render findings to Markdown or process them as JSON.
- Provide shared types for rules, findings, boundaries, and severities.

## Installation
```bash
pnpm add @sentinel/core
```

## Quick start
```ts
import { analyzeDiff } from '@sentinel/core'
import type { RulesJson } from '@sentinel/core'

const diffText = `diff --git a/a.ts b/a.ts ...`

const rules: RulesJson = {
  version: 1,
  domain: 'frontend',
  rules: [
    {
      id: 'style.no-todo-comment',
      area: 'DX',
      severity: 'minor',
      description: 'Avoid TODO comments in code',
      link: 'docs/handbook/style.md#no-todo',
    },
  ],
}

const result = analyzeDiff({ diffText, rulesJson: rules })
console.log(result)
// → ReviewFinding[]
```

## Main concepts
*	Rules (rules.json) define identifiers, severity, and links to documentation.
*	Boundaries (boundaries.json) enforce import restrictions between layers/features.
*	Engine runs deterministic checks (regex, import graph) without involving AI.
*	LLM checks are delegated to external providers, not part of this package.

## Public API
```ts
// Parsing
parseUnifiedDiff(diffText: string): ParsedFile[]

// Static engine
analyzeDiff(input: {
  diffText: string
  rulesById?: Map<string, RuleItem>
  rulesJson?: RulesJson | null
  boundaries?: BoundariesConfig | null
}): ReviewFinding[]

// Rendering
renderMarkdown(findings: ReviewFinding[], opts?: {
  template?: string
  severityMap?: Record<Severity, string>
}): string

// Helpers
makeFingerprint(ruleId: string, file: string, locator: string, snippet: string): string
```

## Types
*	ReviewFinding — one violation (rule, severity, file, locator, why/suggestion).
*	RulesJson / RuleItem — schema for rules.json.
*	BoundariesConfig — schema for boundaries.json.
*	Severity — one of critical | major | minor | info.

## Notes
*	Public API is re-exported from src/index.ts.
*	Everything else in src/* is considered internal.
