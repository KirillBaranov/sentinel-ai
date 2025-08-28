# Contributing to Sentinel AI

Thanks for your interest in contributing 🚀  
We welcome pull requests, bug reports, and feature discussions.  
To keep the project healthy and consistent, please follow these guidelines.

---

## 🛠 Development Setup

1. **Fork & clone** the repository:
```bash
git clone https://github.com/<your-fork>/sentinel-ai.git
cd sentinel-ai
```
2. **Install dependencies** (pnpm is required): 
```bash
pnpm install
```
3.	**Build all packages**: 
  ```bash
pnpm -r build
  ```
4.  **Run tests & lint:**
 ```bash
pnpm test
pnpm lint
 ```

## 📂 Project Structure
*	packages/core → core library (parsing, normalization, rendering)
*	packages/cli → CLI tool (sentinel)
*	packages/providers/* → provider integrations (OpenAI, Claude, Mock)
*	profiles/<domain> → rules, handbook, ADRs per domain
*	apps/demo → demo app for testing review
*	tools/ → build, metrics, and helper scripts

## 📜 Commit Convention

We use Conventional Commits:
```bash
<type>(<scope>): <message>
```

**Common types:**
*	feat: new feature
*	fix: bug fix
*	docs: documentation changes (README, handbook, ADRs)
*	test: add or update tests
*	refactor: code restructuring (incl. TypeScript types)
*	chore: build process, tooling, dependencies

**Examples**:
*	feat(cli): add review command
*	fix(core): correct diff parser edge cases
*	docs(readme): update Quick Start section
*	test(core): add normalize() unit tests

⸻

## ✅ Pull Request Guidelines
1.	Create a feature branch:
```bash
git checkout -b feat/my-feature
```
2. 	Ensure tests and lint pass before pushing:
```bash
pnpm lint
pnpm test
```

## Update documentation if needed (README.md, handbook, ADRs).
* Keep PRs small and focused (one logical change per PR).
* Write a clear PR description:
* Problem — what’s the issue?
* Solution — what you did
* Notes/Trade-offs — anything reviewers should know

⸻

🧪 Testing
*	Unit tests:
```bash
pnpm -r test
```

* Coverage:
```bash
pnpm test:coverage
```

We use Vitest and @testing-library conventions.

## 📄 License

By contributing, you agree that your contributions will be licensed under the MIT License.



