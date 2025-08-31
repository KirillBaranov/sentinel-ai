import { renderMarkdown } from '@sentinel/core'

const findings = []
const md = renderMarkdown(findings)

const el = document.getElementById('app')!
el.innerHTML = `
  <h1>Sentinel Demo</h1>
  <p>Сборка проходит, Vite видит index.html и main.ts.</p>
  <pre style="white-space:pre-wrap">${md}</pre>
`
