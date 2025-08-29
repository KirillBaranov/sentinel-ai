import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// packages/core
const PKG_ROOT = path.resolve(__dirname, '..', '..')
const SCHEMA_PATH_SRC = path.join(PKG_ROOT, 'src', 'lib', 'schema', 'rules.schema.json')
const SCHEMA_PATH_DIST = path.join(PKG_ROOT, 'dist', 'lib', 'schema', 'rules.schema.json')

function readArg(flag: string, fallback?: string) {
  const i = process.argv.indexOf(flag)
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]
  return fallback
}

function resolveProfilesDir(repoRoot: string, explicit?: string) {
  const envDir = process.env.SENTINEL_PROFILES_DIR
  const wanted = explicit ?? envDir
  const candidates = [
    wanted ? (path.isAbsolute(wanted) ? wanted : path.join(repoRoot, wanted)) : null,
    path.join(repoRoot, 'profiles'),
    path.join(repoRoot, 'packages', 'profiles'),
  ].filter(Boolean) as string[]
  for (const c of candidates) if (fs.existsSync(c)) return c
  throw new Error(`profiles dir not found, tried:\n${candidates.join('\n')}`)
}

function fail(msg: string): never {
  console.error(msg)
  process.exit(1)
}

async function main() {
  const profile = readArg('--profile', 'frontend')!
  const profilesDir = readArg('--profiles-dir', undefined)

  // repo root: packages/core → packages → <root>
  const REPO_ROOT = path.resolve(PKG_ROOT, '..', '..')
  const PROFILES = resolveProfilesDir(REPO_ROOT, profilesDir)

  const rulesPath = path.join(PROFILES, profile, 'docs', 'rules', 'rules.json')
  const schemaPath = fs.existsSync(SCHEMA_PATH_SRC) ? SCHEMA_PATH_SRC
    : fs.existsSync(SCHEMA_PATH_DIST) ? SCHEMA_PATH_DIST
      : null

  if (!fs.existsSync(rulesPath)) fail(`[validate-rules] rules.json not found: ${rulesPath}`)
  if (!schemaPath) fail(`[validate-rules] schema not found (checked: ${SCHEMA_PATH_SRC} and ${SCHEMA_PATH_DIST})`)

  const data = JSON.parse(fs.readFileSync(rulesPath, 'utf8'))
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'))

  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    validateSchema: false,
  })
  addFormats(ajv)

  const validate = ajv.compile(schema)
  const ok = validate(data)

  if (!ok) {
    console.error('[validate-rules] ❌ invalid rules.json')
    for (const err of validate.errors ?? []) {
      console.error(`- ${err.instancePath || '(root)'} ${err.message}`)
    }
    process.exit(2)
  }

  console.log('[validate-rules] ✅ rules.json is valid')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
