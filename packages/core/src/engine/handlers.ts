/** Статические обработчики. Никаких правил «по id» — только по типу триггера/политике evidence. */

import { DiffIndex, RuleConstraint, ReviewFinding } from '../types'
import { anyExempt, anyMatch } from '../postprocess/matchers'
import { evidenceLine, buildFinding } from './buildFinding'

type HandlerArgs = {
  rule: RuleConstraint
  diff: DiffIndex
}

export const handlers = {
  /**
   * Буквальный матч сигналов (regex/added-line/pattern) на добавленных строках.
   * Используется для строгих правил вроде sec.no-secrets, logging.no-debug-in-prod.
   */
  pattern({ rule, diff }: HandlerArgs): ReviewFinding[] {
    const out: ReviewFinding[] = []
    for (const file of diff.files) {
      const added = diff.addedByFile[file] || []
      if (!added.length) continue

      const texts = added.map((a) => a.text)
      if (anyExempt(texts, rule.exempt)) continue
      if (rule.requireSignalMatch && !anyMatch(texts, rule.signals)) continue

      for (const a of added) {
        // точечный матч на строку
        if (rule.requireSignalMatch && !anyMatch([a.text], rule.signals)) continue
        out.push(
          buildFinding({
            rule: rule.id,
            area: rule.area || 'general',
            severity: rule.severity || 'minor',
            file,
            locator: `L${a.line}`,
            finding: [evidenceLine(a.line, a.text, 'Matched signal')],
            why: 'Added line matches rule signal and is not exempted.',
            suggestion: 'Review and apply the project guideline for this rule.',
          }),
        )
      }
    }
    return out
  },

  /**
   * Heuristic/hybrid — по умолчанию сводим к pattern на added-lines.
   * (Позже сюда можно добавить лёгкую логику — напр., анализ import-графа из контекста.)
   */
  heuristic(args: HandlerArgs): ReviewFinding[] {
    return handlers.pattern(args)
  },

  hybrid(args: HandlerArgs): ReviewFinding[] {
    return handlers.pattern(args)
  },
}
