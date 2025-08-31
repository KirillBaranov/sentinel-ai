import picomatch from 'picomatch'

export type BoundaryLayer = { name: string; path: string; index: number }
export type BoundaryRule = {
  rule: string
  from: { glob: string }
  to: { glob: string }
  allowVia?: string[]
  explain?: string
}
export type BoundariesConfig = {
  layers?: BoundaryLayer[]
  forbidden: BoundaryRule[]
}

export type ImportEdge = {
  fromFile: string
  specifier: string
}

/** Normalize to POSIX separators regardless of current platform */
export function toPosix(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+/g, '/')
}

/** Extract module specifier from ESM import/export lines (very small parser). */
export function extractImportSpecifier(line: string): string | null {
  // drop line comments to avoid false positives like `// import "x"`
  let s = line.replace(/\/\/.*$/, '').trim()
  if (!s) return null

  // import x from 'foo' | import {a} from "foo"
  const m1 = s.match(/\bfrom\s+['"]([^'"]+)['"]/)
  if (m1) return m1[1] || null

  // bare import 'foo'
  const m2 = s.match(/\bimport\s+['"]([^'"]+)['"]/)
  if (m2) return m2[1] || null

  // export * from 'foo'
  const m3 = s.match(/\bexport\s+\*\s+from\s+['"]([^'"]+)['"]/)
  if (m3) return m3[1] || null

  // export { x, y } from 'foo'
  const m4 = s.match(/\bexport\s+{[^}]*}\s+from\s+['"]([^'"]+)['"]/)
  if (m4) return m4[1] || null

  return null
}

export function violatesRule(edge: ImportEdge, rule: BoundaryRule): boolean {
  const fromOk = picomatch(rule.from.glob, { dot: true })(edge.fromFile)
  if (!fromOk) return false

  const spec = edge.specifier.replace(/^(?:\.\.?\/)+/, '')

  if (rule.allowVia && rule.allowVia.some(glob => picomatch(glob, { dot: true })(spec))) {
    return false
  }
  const toOk = picomatch(rule.to.glob, { dot: true })(spec)
  return !!toOk
}

export function checkForbidden(edge: ImportEdge, cfg: BoundariesConfig): BoundaryRule[] {
  const out: BoundaryRule[] = []
  for (const r of cfg.forbidden || []) {
    if (violatesRule(edge, r)) out.push(r)
  }
  return out
}
