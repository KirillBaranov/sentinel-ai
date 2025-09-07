export function compileMatcher(signal: string): (s: string) => boolean {
  if (signal.startsWith('regex:')) {
    const pat = signal.slice(6)
    const re = new RegExp(pat, 'm')
    return (s: string) => re.test(s)
  }
  if (signal.startsWith('added-line:')) {
    const lit = signal.slice(11)
    return (s: string) => s.includes(lit)
  }
  if (signal.startsWith('pattern:')) {
    const lit = signal.slice(8)
    return (s: string) => s.includes(lit)
  }
  return (s: string) => s.includes(signal)
}

export function anyMatch(lines: string[], signals: string[]): boolean {
  if (!signals?.length) return false
  const matchers = signals.map(compileMatcher)
  return lines.some((line) => matchers.some((m) => m(line)))
}

export function anyExempt(lines: string[], exempts: string[]): boolean {
  if (!exempts?.length) return false
  const matchers = exempts.map(compileMatcher)
  return lines.some((line) => matchers.some((m) => m(line)))
}
