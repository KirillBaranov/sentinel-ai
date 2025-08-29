import path from 'node:path'
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

export function toPosix(p: string): string {
  return p.split(path.sep).join('/')
}

export function extractImportSpecifier(line: string): string | null {
  const m1 = line.match(/\bfrom\s+['"]([^'"]+)['"]/)
  if (m1) return m1[1] || null
  const m2 = line.match(/\bimport\s+['"]([^'"]+)['"]/)
  if (m2) return m2[1] || null
  const m3 = line.match(/\bexport\s+\*\s+from\s+['"]([^'"]+)['"]/)
  if (m3) return m3[1] || null
  return null
}

export function violatesRule(edge: ImportEdge, rule: BoundaryRule): boolean {
  const fromOk = picomatch(rule.from.glob)(edge.fromFile)
  if (!fromOk) return false

  if (rule.allowVia && rule.allowVia.some(glob => picomatch(glob)(edge.specifier))) {
    return false
  }
  const toOk = picomatch(rule.to.glob)(edge.specifier)
  return !!toOk
}

export function checkForbidden(edge: ImportEdge, cfg: BoundariesConfig): BoundaryRule[] {
  const out: BoundaryRule[] = []
  for (const r of cfg.forbidden || []) {
    if (violatesRule(edge, r)) out.push(r)
  }
  return out
}
