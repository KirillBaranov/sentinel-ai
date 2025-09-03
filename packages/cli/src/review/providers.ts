import type { ReviewProvider } from '@sentinel/provider-types'
import { mockProvider } from '@sentinel/provider-mock'
import { localProvider } from '@sentinel/provider-local'

export function pickProvider(id?: string): ReviewProvider {
  const name = (id || process.env.SENTINEL_PROVIDER || 'local').toLowerCase()
  if (name === 'mock') return mockProvider
  return localProvider
}
