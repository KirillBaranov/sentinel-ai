import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ReviewJson } from '@sentinel/core'
import { renderMarkdownFromJson } from './render-md'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../../../../')

function wrapHtml(title: string, md: string) {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const lines = md.split('\n')
  const out: string[] = []
  for (const l of lines) {
    if (/^#\s+/.test(l)) out.push(`<h1>${escape(l.replace(/^#\s+/, ''))}</h1>`)
    else if (/^##\s+/.test(l)) out.push(`<h2>${escape(l.replace(/^##\s+/, ''))}</h2>`)
    else if (/^-\s/.test(l)) out.push(`<li>${escape(l.slice(2))}</li>`)
    else if (/^\s{2}-\s/.test(l)) out.push(`<li style="margin-left:20px">${escape(l.trim().slice(2))}</li>`)
    else if (l.trim() === '---') out.push('<hr/>')
    else if (l.trim() === '') out.push('<br/>')
    else out.push(`<p>${escape(l)}</p>`)
  }
  const htmlBody = out.join('\n').replace(/(<li[\s\S]*?>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escape(title)}</title>
<style>
 body{font:14px/1.5 system-ui,sans-serif;max-width:900px;margin:32px auto;padding:0 16px}
 code,pre{font-family:ui-monospace,Menlo,monospace}
 h1{font-size:22px} h2{font-size:18px;margin-top:20px}
 ul{margin:6px 0 12px 18px} li{margin:4px 0}
 .muted{opacity:.7}
</style>
<body>
${htmlBody}
</body></html>`
}

export async function renderHtmlCLI(opts: { inFile: string; outFile: string }) {
  const inAbs = path.isAbsolute(opts.inFile) ? opts.inFile : path.join(REPO_ROOT, opts.inFile)
  const outAbs = path.isAbsolute(opts.outFile) ? opts.outFile : path.join(REPO_ROOT, opts.outFile)
  const raw = fs.readFileSync(inAbs, 'utf8')
  const json = JSON.parse(raw) as ReviewJson
  const md = renderMarkdownFromJson(json)
  const html = wrapHtml('Sentinel AI Review', md)
  fs.mkdirSync(path.dirname(outAbs), { recursive: true })
  fs.writeFileSync(outAbs, html)
  console.log(`[render-html] wrote ${path.relative(REPO_ROOT, outAbs)}`)
}
