import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  target: 'node18',              // для CLI/Node
  platform: 'node',
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  splitting: false,
  treeshake: false,
  dts: false,
  external: [
    'better-sqlite3',
  ],
  shims: false,
  banner: {
    js: `
import { createRequire as __createRequire } from 'module';
const require = __createRequire(import.meta.url);
`.trim(),
  },
})
