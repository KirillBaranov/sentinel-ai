import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

type Sandbox = {
  root: string
  prevEnv: NodeJS.ProcessEnv
  cleanup: () => void
}

export function makeSandbox(prefix = 'sentinel-sbx-'): Sandbox {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), '# sbx\n', 'utf8')
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'sbx' }), 'utf8')
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true })

  const prevEnv = { ...process.env }
  process.env.SENTINEL_REPO_ROOT = root

  fs.mkdirSync(path.join(root, 'fixtures'), { recursive: true })
  fs.writeFileSync(path.join(root, 'fixtures', 'changes.diff'), 'diff --git a/a.ts b/a.ts\n', 'utf8')

  return {
    root,
    prevEnv,
    cleanup: () => {
      process.env = prevEnv
      try { fs.rmSync(root, { recursive: true, force: true }) } catch {}
    }
  }
}

export async function withSandbox<T>(fn: (sbx: Sandbox) => Promise<T> | T): Promise<T> {
  const sbx = makeSandbox()
  try {
    return await fn(sbx)
  } finally {
    sbx.cleanup()
  }
}

export function makeProfile(root: string, name = 'frontend') {
  const profilesDir = path.join(root, 'packages', 'profiles')
  const pRoot = path.join(profilesDir, name)
  const hb = path.join(pRoot, 'docs', 'handbook')
  const rules = path.join(pRoot, 'docs', 'rules')

  fs.mkdirSync(hb, { recursive: true })
  fs.mkdirSync(rules, { recursive: true })

  fs.writeFileSync(path.join(hb, 'architecture.md'), '# Arch\n', 'utf8')
  fs.writeFileSync(path.join(rules, 'rules.json'), JSON.stringify({
    version: 1, domain: name, rules: [{ id: 'r1', severity: 'major' }]
  }, null, 2), 'utf8')
  fs.writeFileSync(path.join(rules, 'boundaries.json'), JSON.stringify({
    layers: [], forbidden: []
  }, null, 2), 'utf8')

  return { profilesDir, pRoot }
}
