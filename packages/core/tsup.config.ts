import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    // 'scripts/validate-rules': 'src/scripts/validate-rules.ts',
  },
  outDir: 'dist',
  format: ['esm'],
  sourcemap: true,
  clean: true,
  dts: false,
  treeshake: true,
  target: 'es2022',
  external: ['ajv', 'ajv-formats', 'yaml', 'picomatch']
})
