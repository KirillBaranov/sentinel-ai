import type { Severity } from '@sentinel/core'

export function computeImpactScore(params: {
  counts: Partial<Record<Severity, number>>,
  hasArchFindings?: boolean,
}) {
  const { counts, hasArchFindings } = params
  const w = { critical: 1.0, major: 0.6, minor: 0.25, info: 0.1 }
  const sum =
    (counts.critical ?? 0) * w.critical +
    (counts.major ?? 0) * w.major +
    (counts.minor ?? 0) * w.minor +
    (counts.info ?? 0) * w.info

  const bonus = hasArchFindings ? 0.25 : 0
  const raw = Math.min(1, sum + bonus)

  return Number(raw.toFixed(3))
}
