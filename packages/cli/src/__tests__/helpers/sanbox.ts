import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function createTmpRepo(prefix = 'sentinel-'): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  fs.mkdirSync(path.join(tmp, 'dist'), { recursive: true })
  fs.mkdirSync(path.join(tmp, 'fixtures'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'fixtures', 'changes.diff'), 'diff --git a/a.ts b/a.ts\n')
  return tmp
}

export function makeProfileTree(repoRoot: string, profile = 'frontend') {
  const profilesDir = path.join(repoRoot, 'packages', 'profiles')
  const pRoot = path.join(profilesDir, profile)
  const hb = path.join(pRoot, 'docs', 'handbook')
  const rules = path.join(pRoot, 'docs', 'rules')
  fs.mkdirSync(hb, { recursive: true })
  fs.mkdirSync(rules, { recursive: true })
  fs.writeFileSync(path.join(hb, 'architecture.md'), '# Arch\n')
  fs.writeFileSync(path.join(rules, 'rules.json'), JSON.stringify({
    version: 1, domain: profile, rules: [{ id: 'r1', severity: 'major' }]
  }, null, 2))
  fs.writeFileSync(path.join(rules, 'boundaries.json'), JSON.stringify({
    layers: [], forbidden: []
  }, null, 2))
  return { profilesDir, pRoot }
}

export function profileRoot(repoRoot: string, name: string) {
  return path.join(repoRoot, 'packages', 'profiles', name)
}
