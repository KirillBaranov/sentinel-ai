import fs from 'node:fs'
import path from 'node:path'

import type { RulesJson, BoundariesConfig } from '@sentinel/core'

export function resolveProfileRoot(repoRoot: string, profile: string, profilesDir?: string): string {
  if (profile.includes('/') || profile.startsWith('.') || path.isAbsolute(profile)) {
    const abs = path.isAbsolute(profile) ? profile : path.join(repoRoot, profile)
    if (!fs.existsSync(abs)) throw new Error(`[profile] path not found: ${abs}`)
    return abs
  }
  if (profilesDir) {
    const base = path.isAbsolute(profilesDir) ? profilesDir : path.join(repoRoot, profilesDir)
    const candidate = path.join(base, profile)
    if (fs.existsSync(candidate)) return candidate
  }
  const candidates = [
    path.join(repoRoot, 'profiles', profile),
    path.join(repoRoot, 'packages', 'profiles', profile),
  ]
  for (const c of candidates) if (fs.existsSync(c)) return c
  throw new Error(`[profile] not found: "${profile}" (tried: ${candidates.join(', ')})`)
}

export function loadRules(repoRoot: string, profile: string, profilesDir?: string): RulesJson | null {
  const root = resolveProfileRoot(repoRoot, profile, profilesDir)
  const rulesPath = path.join(root, 'docs', 'rules', 'rules.json')
  try {
    return JSON.parse(fs.readFileSync(rulesPath, 'utf8')) as RulesJson
  } catch {
    console.warn(`[review] rules.json not found or invalid for profile=${profile}. Looked at: ${rulesPath}`)
    return null
  }
}

export function loadBoundaries(repoRoot: string, profile: string, profilesDir?: string): BoundariesConfig | null {
  const root = resolveProfileRoot(repoRoot, profile, profilesDir)
  const p = path.join(root, 'docs', 'rules', 'boundaries.json')
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as BoundariesConfig
  } catch {
    console.warn(`[review] boundaries.json not found for profile=${profile} (expected at ${p})`)
    return null
  }
}
