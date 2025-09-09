import { renderMarkdown, renderHtml } from '@sentinel/core'

// demo: пустой список, чтобы показать, что всё подключено
const findings: any[] = []
const md = renderMarkdown(findings, { groupByFile: true })
const html = renderHtml(findings, { includeStyles: true, groupByFile: true })

const el = document.getElementById('app')!
el.innerHTML = `
  <h1>Sentinel Demo</h1>
  <p>Сборка проходит, Vite видит index.html и main.ts.</p>
  <h2>HTML</h2>
  ${html}
  <h2>Markdown</h2>
  <pre style="white-space:pre-wrap">${md}</pre>
`
