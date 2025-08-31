import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  server: { port: 5173 },
  resolve: {
    alias: {
      '@sentinel/core': resolve(__dirname, '../../packages/core/dist/index.js')
    }
  },
  optimizeDeps: {
    include: ['@sentinel/core']
  },
  build: {
    commonjsOptions: {
      include: [/node_modules/]
    }
  }
})
