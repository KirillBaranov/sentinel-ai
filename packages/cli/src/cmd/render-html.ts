// packages/cli/src/cmd/render-html.ts
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ReviewJson } from '@sentinel/core'
import { renderMarkdownFromJson } from './render-md.js'
import {
  findRepoRoot,
  ensureDirForFile,
  printRenderSummaryHtml,
} from '../cli-utils.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = findRepoRoot(path.resolve(__dirname))

/** very small Markdown → HTML (headings, lists, hr, p, inline/code fences) */
function mdToHtml(md: string) {
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const lines = md.split('\n')
  const out: string[] = []
  let inCode = false
  let codeBuf: string[] = []
  let listOpen = false

  const flushList = () => {
    if (listOpen) {
      out.push('</ul>')
      listOpen = false
    }
  }
  const openListIfNeeded = () => {
    if (!listOpen) {
      out.push('<ul>')
      listOpen = true
    }
  }

  for (const l of lines) {
    // fenced code blocks ```
    const fence = l.match(/^```(.*)$/)
    if (fence) {
      if (!inCode) {
        inCode = true
        codeBuf = []
      } else {
        const codeHtml = `<pre><code>${escape(codeBuf.join('\n'))}</code></pre>`
        out.push(codeHtml)
        inCode = false
      }
      continue
    }
    if (inCode) {
      codeBuf.push(l)
      continue
    }

    // horizontal rule
    if (/^---\s*$/.test(l)) {
      flushList()
      out.push('<hr/>')
      continue
    }

    // headings
    if (/^#\s+/.test(l)) {
      flushList()
      out.push(`<h1>${escape(l.replace(/^#\s+/, ''))}</h1>`)
      continue
    }
    if (/^##\s+/.test(l)) {
      flushList()
      out.push(`<h2>${escape(l.replace(/^##\s+/, ''))}</h2>`)
      continue
    }

    // list items (1 level)
    if (/^\s*-\s+/.test(l)) {
      openListIfNeeded()
      const text = l.replace(/^\s*-\s+/, '')
      const withInline = escape(text).replace(/`([^`]+)`/g, '<code>$1</code>')
      out.push(`<li>${withInline}</li>`)
      continue
    }

    // blank → paragraph break
    if (l.trim() === '') {
      flushList()
      out.push('<br/>')
      continue
    }

    // paragraph (with inline code support)
    flushList()
    const withInline = escape(l).replace(/`([^`]+)`/g, '<code>$1</code>')
    out.push(`<p>${withInline}</p>`)
  }
  flushList()
  return out.join('\n')
}

function wrapHtml(title: string, md: string) {
  const body = mdToHtml(md)
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  return `<!doctype html>
<html lang="en">
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body{font:14px/1.55 system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,'Helvetica Neue',Arial,sans-serif;
       max-width:900px;margin:32px auto;padding:0 16px}
  h1{font-size:22px;margin:.6em 0}
  h2{font-size:18px;margin:1.2em 0 .4em}
  ul{margin:.3em 0 1em 1.2em;padding:0}
  li{margin:.25em 0}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;
       background:rgba(127,127,127,.12);padding:.1em .3em;border-radius:.25rem}
  pre{background:rgba(127,127,127,.12);padding:12px;border-radius:.5rem;overflow:auto}
  hr{border:0;height:1px;background:linear-gradient(90deg,transparent,#ccc,transparent);margin:1.2em 0}
  .muted{opacity:.7}
</style>
<body>
${body}
</body></html>`
}

export async function renderHtmlCLI(opts: { inFile: string; outFile: string }) {
  const inAbs  = path.isAbsolute(opts.inFile)  ? opts.inFile  : path.join(REPO_ROOT, opts.inFile)
  const outAbs = path.isAbsolute(opts.outFile) ? opts.outFile : path.join(REPO_ROOT, opts.outFile)

  const raw = fs.readFileSync(inAbs, 'utf8')
  const json = JSON.parse(raw) as ReviewJson

  const md = renderMarkdownFromJson(json)
  const html = wrapHtml('Sentinel AI Review', md)

  ensureDirForFile(outAbs)
  fs.writeFileSync(outAbs, html, 'utf8')

  // unified summary
  printRenderSummaryHtml({
    repoRoot: REPO_ROOT,
    inFile: inAbs,
    outFile: outAbs,
  })
}
