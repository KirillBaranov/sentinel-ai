/** Главный оркестратор ядра: строит diff-индекс, дергает обработчики по триггерам,
 * применяет «решётку» (gate), возвращает findings и LLM-задачи.
 */

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

export function runStaticEngine(params: {
  diffText: string
  rules?: RulesJson | null
}): CoreResult {
  const parsed = parseUnifiedDiff(params.diffText) as unknown as Omit<DiffIndex, 'raw'>
  const diff: DiffIndex = { raw: params.diffText, ...(parsed as any) }
  const rcs: RuleConstraint[] = deriveRuleConstraints(params.rules!)

  const findings: ReviewFinding[] = []
  const llm_tasks: CoreResult['llm_tasks'] = []

  for (const rc of rcs) {
    if (!rc) continue
    const type = (params.rules?.rules.find(r => r.id === rc.id)?.trigger?.type) || 'pattern'
    const handler = (handlers as any)[type] as ((a: any) => ReviewFinding[]) | undefined
    if (!handler) continue

    // Простая версия gate — сейчас общая на файл (в handler есть циклы по файлам)
    // Если понадобится — перенесём логику gate внутрь handler'ов пофайлово.
    const produced = handler({ rule: rc, diff })
    findings.push(...produced)

    // Если правило типа 'llm' — статикой ничего не делаем, но создаём LLM-задачи (контекст).
    if (type === 'llm') {
      for (const file of diff.files) {
        const added = diff.addedByFile[file] || []
        if (!added.length) continue
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

  return { findings, llm_tasks }
}
