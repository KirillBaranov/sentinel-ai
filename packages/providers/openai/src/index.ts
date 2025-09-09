import fs from 'node:fs'
import path from 'node:path'
import OpenAI from 'openai'

import type {
  ReviewJson,
  ReviewFinding,
  RulesJson,
  ProviderReviewInput,
} from '@sentinel/core'

import {
  buildSystemPrompt,
  buildUserPrompt,
  normalizeAndGate,
  parseUnifiedDiff,
} from '@sentinel/core'
import { buildProviderOutput, ReviewProvider } from '@sentinel/provider-types'

/* ──────────────────────────────────────────────────────────────
 * small debug helpers (write only when debug.enabled=true)
 * ──────────────────────────────────────────────────────────── */
function debugDump(dir: string, name: string, data: unknown) {
  try {
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, name)
    const content =
      typeof data === 'string' ? data : JSON.stringify(data, null, 2)
    fs.writeFileSync(file, content, 'utf8')
  } catch {}
}

/* ──────────────────────────────────────────────────────────────
 * JSON parsing: tolerate fenced blocks ```json ... ```
 * ──────────────────────────────────────────────────────────── */
function extractJson(text: string): any {
  const t = String(text || '').trim()

  // strip ```json ... ``` fences if present
  const fenced: RegExpMatchArray | null = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const bodyStr: string = fenced?.[1] ?? t

  // try direct parse
  try {
    return JSON.parse(bodyStr)
  } catch {}

  // try to locate first JSON object
  const firstBrace = bodyStr.indexOf('{')
  const lastBrace = bodyStr.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const slice = bodyStr.slice(firstBrace, lastBrace + 1)
    try {
      return JSON.parse(slice)
    } catch {}
  }
  // fallback
  return { findings: [] }
}

/* ──────────────────────────────────────────────────────────────
 * Provider
 * ──────────────────────────────────────────────────────────── */
export const openaiProvider: ReviewProvider = {
  name: 'openai',
  async review(input: ProviderReviewInput): Promise<ReviewJson> {
    const systemMsgs = buildSystemPrompt()
    const userMsg = buildUserPrompt(input)

    // debug input
    if (input.debug?.enabled) {
      debugDump(input.debug.dir, '01.system.txt', systemMsgs.join('\n'))
      debugDump(input.debug.dir, '02.user.txt', userMsg)
      debugDump(input.debug.dir, '03.rules.compact.json', {
        version: (input.rules as RulesJson | null)?.version ?? null,
        count: (input.rules as RulesJson | null)?.rules?.length ?? 0,
      })
    }

    const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY
    if (!apiKey) {
      throw new Error(
        '[provider-openai] OPENAI_API_KEY is required (env var not set).'
      )
    }

    const client = new OpenAI({ apiKey })
    const model =
      input.providerOptions?.model ||
      process.env.SENTINEL_OPENAI_MODEL ||
      'gpt-4o-mini' // sane default

    const temperature =
      typeof input.providerOptions?.temperature === 'number'
        ? input.providerOptions!.temperature
        : 0

    const maxTokens =
      typeof input.providerOptions?.maxTokens === 'number'
        ? input.providerOptions!.maxTokens
        : undefined

    const resp = await client.chat.completions.create({
      model,
      temperature,
      max_tokens: maxTokens,
      messages: [
        ...systemMsgs.map((s) => ({ role: 'system' as const, content: s })),
        { role: 'user' as const, content: userMsg },
      ],
      response_format: { type: 'json_object' },
    })

    const content = resp.choices?.[0]?.message?.content || ''
    if (input.debug?.enabled) {
      debugDump(input.debug.dir, '11.response.raw.json', resp)
      debugDump(
        input.debug.dir,
        '12.response.content.peek.txt',
        content.slice(0, 2000)
      )
    }

    // tolerant JSON parse
    const llmJson = extractJson(content)
    const parsedDiff = parseUnifiedDiff(input.diffText)
    const rawFindings: any[] = Array.isArray((llmJson as any)?.findings)
      ? (llmJson as any).findings
      : Array.isArray(llmJson)
        ? (llmJson as any[])
        : []
    if (input.debug?.enabled) {
      debugDump(input.debug.dir, '20.input.parsed_diff.json', parsedDiff)
    }

    // post-process in core (centralized gating/sanity)
    const findings: ReviewFinding[] = normalizeAndGate(
      rawFindings,
      parsedDiff,
      input.rules as RulesJson | null
    )

    if (input.debug?.enabled) {
      debugDump(input.debug.dir, '21.findings.normalized.json', findings)
    }

    return buildProviderOutput(findings)
  },
}

export default openaiProvider
