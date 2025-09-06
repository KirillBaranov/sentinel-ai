import fs from 'node:fs'
import path from 'node:path'

export function atomicWrite(file: string, data: string|Buffer) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tmp, data)
  fs.renameSync(tmp, file)
}

export function writeArtifacts(jsonPath: string, mdPath: string, reviewJson: unknown) {
  const json = JSON.stringify(reviewJson, null, 2)
  atomicWrite(jsonPath, json)
  const md = `<!-- SENTINEL:DUAL:JSON -->\n\`\`\`json\n${json}\n\`\`\`\n<!-- SENTINEL:DUAL:JSON:END -->\n`
  atomicWrite(mdPath, md)
}

export function makeLatestPaths(reviewsDirAbs: string, profile: string, mdName = 'review.md', jsonName = 'review.json') {
  const dir = path.join(reviewsDirAbs, profile)
  return { json: path.join(dir, jsonName), md: path.join(dir, mdName) }
}

export function makeHistoryPaths(reviewsDirAbs: string, profile: string, runId: string, mdName = 'review.md', jsonName = 'review.json') {
  const dir = path.join(reviewsDirAbs, profile, runId)
  return { json: path.join(dir, jsonName), md: path.join(dir, mdName) }
}
