# Sentinel AI

**AI-powered code review framework** with profile-based rules, dual output (JSON + Markdown), and GitHub/GitLab integration.  
Designed to catch architectural and stylistic issues beyond static linters.

<p align="center">
  <img src="https://img.shields.io/badge/build-passing-brightgreen" alt="Build Status" />
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License: MIT" />
  <img src="https://img.shields.io/badge/pnpm-workspaces-orange" alt="pnpm workspaces" />
</p>

---

## ✨ Features
- **Profiles**: isolated rule sets (`frontend`, `backend`, `e2e`), each with its own handbook, ADRs, and rules.json.
- **Dual output**: JSON (machine, metrics) + Markdown (developer-friendly).
- **Core/CLI separation**:
  - `@sentinel/core` → parsing, normalization, rendering.
  - `@sentinel/cli` → developer interface and CI integration.
- **AI-assisted findings**: complex cases beyond ESLint/TypeScript.
- **Workspace-friendly**: built with `pnpm` monorepo.

---

## 🚀 Quick Start

```bash
# clone
git clone https://github.com/kirill-baranov/sentinel-ai.git
cd sentinel-ai

# install deps
pnpm install

# build AI context (frontend profile)
pnpm sentinel:context

# run review on demo diff
pnpm sentinel:review
```

### Outputs:
* dist/ai-review-context.md → assembled context (rules + handbook + ADR).
* review.json → machine findings (for metrics).
* review.md → human-readable review report.

## 📂 Project Structure
```bash
apps/           # demo projects
packages/
  core/         # parsing, normalization, rendering
  cli/          # CLI tool
  providers/    # LLM integrations (mock, openai, claude)
profiles/       # rules, handbook, ADR per domain
tools/          # build scripts, diff, metrics
analytics/      # schema + aggregator
```

## 📜 Roadmap
*	Extend rule sets (frontend / backend / e2e).
*	Add provider integrations (OpenAI, Claude).
*	GitHub Actions bot → comment reviews in PR.
*	Web dashboard for metrics & trends.

⸻

## 🤝 Contributing

Contributions welcome!
See CONTRIBUTING.md for guidelines.

⸻

## 📄 License

MIT © Kirill Baranov
