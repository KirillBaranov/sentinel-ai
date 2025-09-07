import type { ReviewFinding, Severity } from '../types'
import crypto from 'node:crypto'

const SEVERITIES: Severity[] = ['critical', 'major', 'minor', 'info']

type RawFinding = {
  rule?: string
  area?: string
  severity?: Severity
  file?: string
  locator?: string
  finding?: string[]
  why?: string
  suggestion?: string
}

function fp(obj: unknown): string {
  try {
    const s = JSON.stringify(obj);
    return crypto.createHash('sha1').update(s).digest('hex');
  } catch {
    return crypto.createHash('sha1').update(String(obj)).digest('hex');
  }
}

export function normalizeFindings(raw: unknown): ReviewFinding[] {
  if (Array.isArray(raw)) {
    return raw as ReviewFinding[]
  }
  const arr: any[] = Array.isArray((raw as any)?.findings) ? (raw as any).findings : []

  const out: ReviewFinding[] = []
  for (const it of arr) {
    const rule = String(it?.rule || '')
    const file = String(it?.file || '')
    if (!rule || !file) continue

    const area = String(it?.area || 'general')
    const sev: Severity = SEVERITIES.includes(it?.severity) ? it.severity : 'minor'
    const locator = String(it?.locator || 'L0')
    const finding = Array.isArray(it?.finding) ? it.finding.map(String) : []
    const why = String(it?.why || '')
    const suggestion = String(it?.suggestion || '')
    const fingerprint =
      String(it?.fingerprint || fp({ rule, area, severity: sev, file, locator, finding, why, suggestion }))

    out.push({ rule, area, severity: sev, file, locator, finding, why, suggestion, fingerprint })
  }
  return out
}
