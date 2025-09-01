import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  outDir: 'dist',
  format: ['esm'],
  sourcemap: true,
  clean: true,
  dts: false,
  treeshake: true,
  target: 'es2022',
  external: [
    '@sentinel/core',
    '@sentinel/provider-types',
    '@sentinel/provider-mock',
    '@sentinel/provider-local',
    '@sentinel/analytics',
    'commander',
    'colorette'
  ],
  banner: {
    js: '#!/usr/bin/env node'
  }
})
