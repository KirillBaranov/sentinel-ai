// src/engine/index.ts
import fs from 'node:fs'
import path from 'node:path'
import { parseUnifiedDiff } from '../diff'
import { deriveRuleConstraints } from '../postprocess/constraints'
import { handlers } from './handlers'
import {
  CoreResult,
  DiffIndex,
  ReviewFinding,
  RuleConstraint,
  RulesJson,
} from '../types'

/** Опции движка: передаём из провайдера при необходимости */
export type EngineOptions = {
  /** Требовать match по сигналам, если rule.trigger.requireSignalMatch=true */
  strictSignals?: boolean
  /** Включить подробные логи */
  debug?: boolean
  /** Куда писать артефакты отладки (любой путь; будет нормализован в абсолютный) */
  debugDir?: string
  /** Кап на кол-во findings для ОДНОГО файла по ОДНОМУ правилу (шумоглушитель) */
  capPerRulePerFile?: number
  /** Опциональный общий кап на правило (в сумме по всем файлам) */
  capPerRuleTotal?: number
  /** Сколько строк «окна» считать охраняющими (exempt) рядом с сигналом */
  exemptWindowLines?: number
}

/* ───────────────── helpers: logging & debug fs ───────────────── */

function isDebugEnabled(opts?: { debug?: boolean }) {
  return !!opts?.debug || process.env.SENTINEL_DEBUG === '1' || process.env.SENTINEL_DEBUG === 'true'
}

function dbg(enabled: boolean, ...args: any[]) {
  if (!enabled || process.env.NODE_ENV === 'production') return
  try { console.log('[core/engine]', ...args) } catch {}
}

function ensureDir(p: string) {
  try { fs.mkdirSync(p, { recursive: true }) } catch {}
}

function writeText(file: string, text: string) {
  try { fs.writeFileSync(file, text, 'utf8') } catch {}
}

function writeJson(file: string, obj: unknown) {
  try { fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8') } catch {}
}

/* ───────────────── signal/exempt matchers ───────────────── */

function compileMatcher(signal: string): (s: string) => boolean {
  if (signal.startsWith('regex:')) {
    const pat = signal.slice(6)
    const re = new RegExp(pat, 'm')
    return (s: string) => re.test(s)
  }
  if (signal.startsWith('added-line:')) {
    const lit = signal.slice(11)
    return (s: string) => s.includes(lit)
  }
  if (signal.startsWith('pattern:')) {
    const lit = signal.slice(8)
    return (s: string) => s.includes(lit)
  }
  return (s: string) => s.includes(signal)
}

function anyMatch(lines: string[], signals: string[]): boolean {
  if (!signals?.length) return false
  const matchers = signals.map(compileMatcher)
  return lines.some((line) => matchers.some((m) => m(line)))
}

function anyExempt(lines: string[], exempts: string[]): boolean {
  if (!exempts?.length) return false
  const matchers = exempts.map(compileMatcher)
  return lines.some((line) => matchers.some((m) => m(line)))
}

/* ───────────────────────── engine ───────────────────────── */

export function runStaticEngine(params: {
  diffText: string
  rules?: RulesJson | null
  options?: EngineOptions
}): CoreResult {
  // 1) нормализуем опции
  const opts: Required<Pick<EngineOptions,
    'strictSignals' | 'capPerRulePerFile' | 'capPerRuleTotal' | 'exemptWindowLines'
  >> & EngineOptions = {
    strictSignals: true,          // по дефолту строго, чтобы не шумело
    capPerRulePerFile: 3,         // разумный дефолт, можно подкрутить в провайдере
    capPerRuleTotal: 50,          // страховка чтобы правило не «взорвалось»
    exemptWindowLines: 5,         // соседний exempt в пределах 5 строк
    ...params.options,
  }

  const debugOn = isDebugEnabled(opts)
  const debugDirAbs = opts.debugDir ? path.resolve(opts.debugDir) : undefined
  if (debugDirAbs) {
    ensureDir(debugDirAbs)
    writeText(path.join(debugDirAbs, '_debug.enabled'), new Date().toISOString())
    dbg(true, `debug artifacts → ${debugDirAbs} (cwd=${process.cwd()})`)
  }

  // 2) соберём diff и ограничения правил
  const parsed = parseUnifiedDiff(params.diffText) as unknown as Omit<DiffIndex, 'raw'>
  const baseDiff: DiffIndex = { raw: params.diffText, ...(parsed as any) }
  const rcs: RuleConstraint[] = deriveRuleConstraints(params.rules!)

  if (debugDirAbs) {
    writeText(path.join(debugDirAbs, '00.diff.raw.peek.txt'), params.diffText.slice(0, 2000))
    writeJson(path.join(debugDirAbs, '01.diff.parsed.json'), baseDiff)
    writeJson(path.join(debugDirAbs, '02.rules.constraints.json'), rcs)
  }

  const gateTrace: any[] = []
  const perRuleStats: Record<string, { type: string; passedFiles: number; produced: number }> = {}
  const findings: ReviewFinding[] = []
  const llm_tasks: CoreResult['llm_tasks'] = []

  // 3) цикл по правилам
  for (const rc of rcs) {
    if (!rc) continue
    const type = (params.rules?.rules.find(r => r.id === rc.id)?.trigger?.type) || 'pattern'
    const handler = (handlers as any)[type] as ((a: any) => ReviewFinding[]) | undefined

    // llm-правила допускаем без handler; остальные — если нет обработчика, пропускаем
    if (!handler && type !== 'llm') continue

    dbg(debugOn, `rule ${rc.id} (type=${type})`)

    // ── GATE: glob + added + signals/exempt (пер-СТРОКА!)
    const hasSignals = Array.isArray(rc.signals) && rc.signals.length > 0
    const needSignal =
      rc.requireSignalMatch === true ||
      (opts.strictSignals === true && hasSignals)

    // glob → RegExp
    const globRes: RegExp[] =
      Array.isArray(rc.file_glob) && rc.file_glob.length
        ? rc.file_glob.map((g) => {
            const escaped = g
              .replace(/[.+^${}()|\[\]\\]/g, '\\$&')
              .replace(/\*\*/g, '::GLOBSTAR::')
              .replace(/\*/g, '[^/]*')
              .replace(/::GLOBSTAR::/g, '.*')
            return new RegExp('^' + escaped + '$')
          })
        : []

    const matchesGlob = (f: string) => globRes.length === 0 || globRes.some((re) => re.test(f))

    const ruleGateSummary = { rule: rc.id, type, files: [] as any[] }
    const filesForRule: string[] = []
    const scopedAddedByFile: DiffIndex['addedByFile'] = {}

    // предкомпилируем матчеры под правило
    const sigMatchers = (rc.signals || []).map(compileMatcher)
    const exMatchers  = (rc.exempt  || []).map(compileMatcher)
    const lineMatchesSignal = (s: string) => sigMatchers.some(m => m(s))
    const lineMatchesExempt = (s: string) => exMatchers.some(m => m(s))

    for (const file of baseDiff.files) {
      const diag: any = { file, matchedGlob: false, hasAdded: false, hasSignal: false, isExempt: false, included: false }

      if (!matchesGlob(file)) { ruleGateSummary.files.push(diag); continue }
      diag.matchedGlob = true

      const added = baseDiff.addedByFile[file] || []
      if (!added.length) { ruleGateSummary.files.push(diag); continue }
      diag.hasAdded = true

      // Фильтрация по СТРОКАМ: берём только те добавленные строки, где
      // 1) есть сигнал, 2) нет exempt в этой же строке, 3) нет соседнего exempt в окне N строк.
      let filtered = added
      if (needSignal) {
        const exLines = added
          .filter(a => lineMatchesExempt(a.text))
          .map(a => a.line)

        const win = Math.max(0, Number(opts.exemptWindowLines) || 0)

        filtered = added.filter(a => {
          const hasSig = lineMatchesSignal(a.text)
          if (!hasSig) return false

          // inline-exempt в той же строке
          if (lineMatchesExempt(a.text)) return false

          // соседний exempt в пределах окна
          if (win > 0 && exLines.some(lno => Math.abs(lno - a.line) <= win)) return false

          return true
        })

        diag.hasSignal = filtered.length > 0
        // считаем файл «exempted», если вообще встретились exempt-строки
        diag.isExempt = exLines.length > 0
        if (!diag.hasSignal) { ruleGateSummary.files.push(diag); continue }
      }

      scopedAddedByFile[file] = filtered
      diag.included = true
      ruleGateSummary.files.push(diag)
      filesForRule.push(file)
    }

    gateTrace.push(ruleGateSummary)
    dbg(debugOn, `  gate: ${filesForRule.length} file(s) passed`)

    perRuleStats[rc.id] = { type, passedFiles: filesForRule.length, produced: 0 }
    if (filesForRule.length === 0) continue

    const scopedDiff: DiffIndex = {
      raw: baseDiff.raw,
      files: filesForRule,
      addedByFile: Object.fromEntries(filesForRule.map(f => [f, scopedAddedByFile[f] || []])),
    }

    if (handler) {
      let produced: ReviewFinding[] = []
      try {
        const res = handler({ rule: rc, diff: scopedDiff })
        produced = Array.isArray(res) ? res : []
      } catch (e) {
        dbg(true, `handler error for rule ${rc.id}:`, e)
        produced = []
      }

      // капы на шум (per-file и total)
      const perFileCounters: Record<string, number> = {}
      const capped: ReviewFinding[] = []

      for (const f of produced) {
        const fileKey = f.file || 'unknown'
        perFileCounters[fileKey] = perFileCounters[fileKey] ?? 0

        // per-file cap
        if (opts.capPerRulePerFile! > 0 && perFileCounters[fileKey] >= opts.capPerRulePerFile!) continue
        perFileCounters[fileKey]++

        // total cap
        if (opts.capPerRuleTotal! > 0 && capped.length >= opts.capPerRuleTotal!) break

        capped.push(f)
      }

      perRuleStats[rc.id]!.produced += capped.length
      if (capped.length) findings.push(...capped)
      dbg(debugOn, `    handler produced: ${capped.length} finding(s)`)
    }

    // llm-задачи (контекст) — только по отфильтрованным файлам
    if (type === 'llm') {
      for (const file of scopedDiff.files) {
        const added = scopedDiff.addedByFile[file] || []
        for (const a of added) {
          llm_tasks.push({
            rule_id: rc.id,
            file,
            locator: `L${a.line}`,
            snippet: a.text.slice(0, 240),
          })
        }
      }
    }
  }

  // 7) финальные артефакты дебага
  if (debugDirAbs) {
    writeJson(path.join(debugDirAbs, 'engine-gate.json'), gateTrace)

    const topRules = Object.entries(perRuleStats)
      .sort((a, b) => b[1].produced - a[1].produced)
      .slice(0, 10)
      .map(([id, v]) => ({ id, ...v }))

    const stats = {
      findings: findings.length,
      llm_tasks: llm_tasks.length,
      rules_seen: rcs.length,
      files_total: (baseDiff.files || []).length,
      rules_with_findings: Object.values(perRuleStats).filter(v => v.produced > 0).length,
      top_rules: topRules,
    }

    writeJson(path.join(debugDirAbs, 'engine-stats.json'), stats)
    writeJson(path.join(debugDirAbs, 'engine-per-rule.json'), perRuleStats)
    writeJson(path.join(debugDirAbs, 'engine-findings.sample.json'), findings.slice(0, 50))

    dbg(debugOn, `debug artifacts written to ${debugDirAbs}`)
  }

  console.log('check and catch me 2')

  return { findings, llm_tasks }
}
