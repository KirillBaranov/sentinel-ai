import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  dts: false,
  sourcemap: true,
  target: 'es2022',
  clean: true,
  outDir: 'dist'
})
