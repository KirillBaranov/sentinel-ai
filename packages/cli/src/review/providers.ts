import type { ReviewProvider } from '@sentinel/provider-types'

// базовые провайдеры (всегда есть)
import { localProvider } from '@sentinel/provider-local'
import { mockProvider } from '@sentinel/provider-mock'

async function tryImportProvider(id: string): Promise<ReviewProvider | null> {
  try {
    const mod = await import(id)
    return (mod as any).openaiProvider
      || (mod as any).claudeProvider
      || (mod as any).default
      || null
  } catch (e: any) {
    if (process.env.SENTINEL_DEBUG) {
      console.warn(`[providers] failed to import ${id}: ${e?.code || e?.name || e}`, e?.message || '')
    }
    return null
  }
}

/** Регистр собираем асинхронно один раз */
let REGISTRY_PROMISE: Promise<Map<string, ReviewProvider>> | null = null

async function buildRegistry(): Promise<Map<string, ReviewProvider>> {
  const reg = new Map<string, ReviewProvider>([
    ['local', localProvider],
    ['mock',  mockProvider],
  ])

  const openai = await tryImportProvider('@sentinel/provider-openai')
  if (openai) reg.set('openai', openai)

  const claude = await tryImportProvider('@sentinel/provider-claude')
  if (claude) reg.set('claude', claude)

  return reg
}

async function getRegistry(): Promise<Map<string, ReviewProvider>> {
  if (!REGISTRY_PROMISE) REGISTRY_PROMISE = buildRegistry()
  return REGISTRY_PROMISE
}

export async function listProviders(): Promise<string[]> {
  const reg = await getRegistry()
  return Array.from(reg.keys()).sort()
}

export async function pickProvider(name?: string): Promise<ReviewProvider> {
  const reg = await getRegistry()
  const key = (name || process.env.SENTINEL_PROVIDER || 'local').toLowerCase()
  const p = reg.get(key)
  if (!p) {
    const available = (await listProviders()).join(', ')
    throw new Error(`Unknown provider "${key}". Available: ${available}`)
  }
  return p
}
