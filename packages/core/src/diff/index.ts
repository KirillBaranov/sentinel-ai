import { AddedLine } from "../types"

export * from "./parse"
export * from "./analyze"

export type ParsedDiff = {
  files: string[]
  addedByFile: Record<string, AddedLine[]>
}

export function parseUnifiedDiff(diff: string): ParsedDiff {
  const files: string[] = []
  const addedByFile: Record<string, AddedLine[]> = {}
  let file = ''
  let newLine = 0
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ b/')) {
      file = raw.slice(6).trim()
      if (!files.includes(file)) files.push(file)
      if (!addedByFile[file]) addedByFile[file] = []
      continue
    }
    const m = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (m) { newLine = Number(m[1]); continue }
    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      if (file) addedByFile[file]!.push({ line: newLine, text: raw.slice(1) })
      newLine++
    } else if (!raw.startsWith('-')) {
      if (raw && !raw.startsWith('@@')) newLine++
    }
  }
  return { files, addedByFile }
}
