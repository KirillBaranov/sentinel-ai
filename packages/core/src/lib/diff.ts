import type { FileDiff, Hunk } from './types'

/**
 * Parse a unified diff string into a list of files with hunks and added lines.
 * Minimal but robust for typical git diffs.
 */
export function parseUnifiedDiff(diff: string): FileDiff[] {
  const files: FileDiff[] = []
  const lines = diff.split(/\r?\n/)
  let current: FileDiff | null = null
  let currentHunk: Hunk | null = null
  let newLineCursor = 0

  const hunkHeaderRe =
    /^@@\s+-(?<oStart>\d+)(?:,(?<oLen>\d+))?\s+\+(?<nStart>\d+)(?:,(?<nLen>\d+))?\s+@@/

  // We lock on +++ b/<path> to get the destination file
  const fileHeaderRe = /^\+\+\+\s+b\/(.+)$/

  for (const line of lines) {
    // New file header?
    const fm = fileHeaderRe.exec(line)
    if (fm && fm[1]) {
      current = { filePath: fm[1], hunks: [] }
      files.push(current)
      currentHunk = null
      // cursor will be set by next hunk header
      continue
    }

    // New hunk header?
    const hm = hunkHeaderRe.exec(line)
    if (hm && current) {
      const oStart = Number(hm.groups!.oStart)
      const oLen = Number(hm.groups!.oLen ?? '0')
      const nStart = Number(hm.groups!.nStart)
      const nLen = Number(hm.groups!.nLen ?? '0')

      currentHunk = {
        oldStart: oStart,
        oldLines: oLen,
        newStart: nStart,
        newLines: nLen,
        header: line,
        added: []
      }
      current.hunks.push(currentHunk)

      // Position cursor one line BEFORE the first new line;
      // we'll increment as we see context/added lines.
      newLineCursor = nStart - 1
      continue
    }

    if (!current) continue

    // Track line number progression on the NEW file side
    if (line.startsWith('+') && !line.startsWith('+++')) {
      // Added line contributes to new file numbering
      newLineCursor += 1
      if (currentHunk) {
        currentHunk.added.push({ line: newLineCursor, text: line.slice(1) })
      }
      continue
    }

    if (line.startsWith(' ') || line === '') {
      // Context line exists in both old/new → advance new side
      newLineCursor += 1
      continue
    }

    // Removed lines ('-') do not advance NEW cursor
    // Any other metadata lines are ignored
  }

  return files
}

/** Canonical string locator for a hunk header */
export function hunkLocator(h: Hunk): string {
  return `HUNK:@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`
}
