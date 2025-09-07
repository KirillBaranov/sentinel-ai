import { AddedLine } from "../types"

export function extractDiffFiles(diff: string): string[] {
  const set = new Set<string>()
  const re = /^\+\+\+\s+b\/(.+)$/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(diff))) set.add(m[1]!.trim())
  return Array.from(set)
}

export function addedLinesByFile(diff: string): Record<string, AddedLine[]> {
  const out: Record<string, AddedLine[]> = {}
  let file = ''
  let newLine = 0
  const lines = diff.split('\n')

  for (const line of lines) {
    if (line.startsWith('+++ b/')) {
      file = line.slice(6).trim()
      if (!out[file]) out[file] = []
      continue
    }
    const m = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (m) {
      newLine = Number(m[1])
      continue
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      if (file) out[file]!.push({ line: newLine, text: line.slice(1) })
      newLine++
    } else if (!line.startsWith('-')) {
      // context line
      if (line && !line.startsWith('@@')) newLine++
    }
  }
  return out
}
