# @sentinel/cli

Command-line interface for **Sentinel AI**.  
Provides commands to build review context, run analysis (local or AI-powered), and render results.

## Features
- Build a **review context** from rules, boundaries, and handbooks.
- Run **code review**:
  - Local static engine (`--provider local`).
  - AI adapters (`--provider mock`, `--provider openai`, …).
- Export results in **dual format**:
  - Canonical JSON (`review.json`).
  - Markdown transport (`review.md` with embedded JSON block).
- Render JSON results into human-readable Markdown or HTML.

## Installation
```bash
pnpm add -D @sentinel/cli
```

## Usage
```bash
pnpm sentinel --help
```

## Commands

### build-context
Build a full context file (used as prompt grounding for providers).
```bash
pnpm sentinel build-context --profile frontend --profiles-dir packages/profiles --out dist/ai-review-context.md
```

**Options:**
- `--profile <profile>` — profile name (default: `frontend`).
- `--profiles-dir <dir>` — custom profiles root.
- `--out <path>` — output file (repo-root relative).

### review
Run code review against a unified diff.
```bash
pnpm sentinel review \
  --diff ../../fixtures/changes.diff \
  --profile frontend \
  --profiles-dir packages/profiles \
  --provider local \
  --out-md review.md \
  --out-json review.json
```

**Options:**
- `--diff <path>` — unified diff file (**required**).
- `--profile <profile>` — which profile to use (default: `frontend`).
- `--profiles-dir <dir>` — override profiles root.
- `--provider <name>` — `local | mock | openai` (default: `local`).
- `--out-md <path>` — transport Markdown with JSON fenced block.
- `--out-json <path>` — canonical JSON.
- `--fail-on <level>` — exit non-zero if max severity ≥ `major | critical`.
- `--max-comments <n>` — cap number of findings.

### render-md
Convert review.json to a readable Markdown report.
```bash
pnpm sentinel render-md --in dist/review.json --out dist/review.human.md
```

**Options:**
- `--template <path>` — custom template file.
- `--severity-map <path>` — JSON remap of severity labels.

### render-html
Convert review.json to an HTML report.
```bash
pnpm sentinel render-html --in dist/review.json --out dist/review.html
```

## Output formats

**Dual file (review.md)**
```md
<!-- SENTINEL:DUAL:JSON -->
{ "ai_review": { "version": 1, "findings": [ ... ] } }
<!-- SENTINEL:DUAL:JSON:END -->
```

**Canonical JSON (`review.json`)**
```json
{
  "ai_review": {
    "version": 1,
    "run_id": "run_1731234567890",
    "findings": [...]
  }
}
```

## CI/CD integration

Minimal example for GitHub Actions:
```yml
- name: Run Sentinel review
  run: |
    pnpm sentinel review \
      --diff diff.patch \
      --profile frontend \
      --provider local \
      --out-md review.md \
      --out-json review.json
```

**Exit codes:**
- **0** — OK or only minor/info findings.
- **10** — max severity is major.
- **20** — max severity is critical.
- or forced failure with `--fail-on`.

## Notes
*	This package is the entrypoint for users of Sentinel AI.
*	Profiles (rules/handbook/boundaries) are external to CLI — you provide your own.





