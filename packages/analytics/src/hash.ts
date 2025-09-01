import crypto from 'node:crypto'
import path from 'node:path'

export function sha1(s: string): string {
  return crypto.createHash('sha1').update(s).digest('hex')
}

export function hashPath(absPath: string, repoRoot: string, salt?: string): string {
  let rel: string
  try { rel = path.relative(repoRoot, absPath) || absPath }
  catch { rel = absPath }
  const base = salt ? `${salt}:${rel}` : rel
  return sha1(base)
}
