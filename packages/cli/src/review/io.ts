import fs from 'node:fs'
import path from 'node:path'
import { ensureDirForFile } from '../cli-utils'

export function prepareOutputs(repoRoot: string, outMd?: string, outJson?: string) {
  const OUT_DIR = path.join(repoRoot, 'dist')
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const toDist = (p: string | undefined, fallbackName: string) =>
    p && path.isAbsolute(p) ? p : path.join(OUT_DIR, path.basename(p || fallbackName))

  return {
    outMdPath: toDist(outMd, 'review.md'),
    outJsonPath: toDist(outJson || 'review.json', 'review.json'),
  }
}

export function readDiff(repoRoot: string, diffPathOrRel: string) {
  const diffPath = path.isAbsolute(diffPathOrRel) ? diffPathOrRel : path.join(repoRoot, diffPathOrRel)
  if (!fs.existsSync(diffPath)) {
    throw new Error(`[review] diff file not found at ${diffPath} (passed: ${diffPathOrRel})`)
  }
  return { diffPath, diffText: fs.readFileSync(diffPath, 'utf8') }
}

export function writeArtifacts(outJsonPath: string, outMdPath: string, reviewJson: unknown) {
  ensureDirForFile(outJsonPath)
  ensureDirForFile(outMdPath)

  // JSON
  const json = JSON.stringify(reviewJson, null, 2)
  fs.writeFileSync(outJsonPath, json, 'utf8')

  // Transport Markdown с вложенным JSON
  const mdPayload =
    `<!-- SENTINEL:DUAL:JSON -->\n` +
    '```json\n' +
    json +
    '\n```\n' +
    `<!-- SENTINEL:DUAL:JSON:END -->\n`

  fs.writeFileSync(outMdPath, mdPayload, 'utf8')
}
