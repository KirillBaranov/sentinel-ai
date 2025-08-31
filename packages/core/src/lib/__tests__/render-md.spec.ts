import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '../render-md'
import type { ReviewFinding } from '../normalize'
import type { RenderOptions } from '../render-config'

function F(partial: Partial<ReviewFinding>): ReviewFinding {
  return {
    rule: 'rule.x',
    area: 'General',
    severity: 'minor',
    file: 'src/a.ts',
    locator: 'L1',
    finding: ['[L1] something happened'],
    why: 'because reasons',
    suggestion: 'do X',
    fingerprint: 'deadbeef'.padEnd(40, 'f'),
    ...partial,
  }
}

describe('renderMarkdown (default mode)', () => {
  it('prints sections per severity with "No issues found" for empty groups', () => {
    const md = renderMarkdown([
      F({ severity: 'minor', rule: 'style.no-todo', file: 'src/a.ts', finding: ['[L3] TODO'] }),
      F({ severity: 'major', rule: 'security.x',   file: 'src/b.ts', finding: ['[L7] bad'] }),
    ])

    // Заголовки (порядок по умолчанию: Critical, Major, Minor, Info)
    expect(md).toMatch(/\n## .*Critical/)
    expect(md).toMatch(/\n## .*Major/)
    expect(md).toMatch(/\n## .*Minor/)
    expect(md).toMatch(/\n## .*Info/)

    // Для пустых секций — маркер "No issues found"
    // (critical и info пустые в этом примере)
    const critSec = md.split('\n## ').find(s => /Critical/.test(s))!
    expect(critSec).toMatch(/No issues found/)

    const infoSec = md.split('\n## ').find(s => /Info/.test(s))!
    expect(infoSec).toMatch(/No issues found/)

    // Есть вывод наших правил
    const majorSec = md.split('\n## ').find(s => /Major/.test(s))!
    expect(majorSec).toMatch(/\*\*security\.x\*\* in `src\/b\.ts`/)
    expect(majorSec).toMatch(/bad/)

    const minorSec = md.split('\n## ').find(s => /Minor/.test(s))!
    expect(minorSec).toMatch(/\*\*style\.no-todo\*\* in `src\/a\.ts`/)
    expect(minorSec).toMatch(/TODO/)
  })

  it('sorts findings inside severity by area, then file; groups by area+file', () => {
    const md = renderMarkdown([
      F({ severity: 'major', area: 'Architecture', file: 'src/z.ts', rule: 'r1', finding: ['[L2] A/Z'] }),
      F({ severity: 'major', area: 'Architecture', file: 'src/a.ts', rule: 'r2', finding: ['[L3] A/A'] }),
      F({ severity: 'major', area: 'Security',     file: 'src/m.ts', rule: 'r3', finding: ['[L4] S/M'] }),
      // тот же area+file → должен попасть под одну «шапку» строки "- **<rule>** in `file`"
      F({ severity: 'major', area: 'Architecture', file: 'src/a.ts', rule: 'r4', finding: ['[L5] A/A second'] }),
    ])

    const majorSec = md.split('\n## ').find(s => /Major/.test(s))!
    // Проверим порядок файлов в разделе Major: Architecture/src/a.ts раньше Architecture/src/z.ts,
    // а Security идет после Architecture.
    const posAA = majorSec.indexOf('**r2** in `src/a.ts`')
    const posAZ = majorSec.indexOf('**r1** in `src/z.ts`')
    const posSM = majorSec.indexOf('**r3** in `src/m.ts`')

    expect(posAA).toBeGreaterThan(-1)
    expect(posAZ).toBeGreaterThan(-1)
    expect(posSM).toBeGreaterThan(-1)
    expect(posAA).toBeLessThan(posAZ)
    expect(posAZ).toBeLessThan(posSM)

    // В группу по src/a.ts попали обе строки
    const groupAA = majorSec.slice(posAA, posAZ)
    expect(groupAA).toMatch(/A\/A/)
    expect(groupAA).toMatch(/A\/A second/)
  })
})

describe('renderMarkdown (template mode)', () => {
  it('renders using a custom simple template', () => {
    const tpl = '- {{severity}} | {{rule}} | {{file}} | {{what}}'
    const opts: RenderOptions = { template: tpl }

    const md = renderMarkdown([
      F({ severity: 'info', rule: 'doc.link', file: 'docs/readme.md', finding: ['[L1] something info'] }),
    ], opts)

    // Заголовок отчета
    expect(md.startsWith('# Sentinel AI Review')).toBe(true)

    // Секция Info присутствует; строка по нашему шаблону — тоже
    const infoSec = md.split('\n## ').find(s => /Info/.test(s))!
    expect(infoSec).toMatch(/- info \| doc\.link \| docs\/readme\.md \| \[L1\] something info/)
  })

  it('supports severityMap override: custom titles and order', () => {
    const opts: RenderOptions = {
      severityMap: {
        order: ['minor', 'critical', 'major', 'info'],
        title: {
          critical: 'Blockers',
          major: 'Serious',
          minor: 'Trivial',
          info: 'Notes',
        },
      },
    }

    const md = renderMarkdown([
      F({ severity: 'major',    rule: 'r.major' }),
      F({ severity: 'minor',    rule: 'r.minor' }),
      F({ severity: 'critical', rule: 'r.critical' }),
    ], opts)

    // Заголовки именно наши
    expect(md).toMatch(/\n## Trivial/)
    expect(md).toMatch(/\n## Blockers/)
    expect(md).toMatch(/\n## Serious/)

    // Проверим порядок: Trivial → Blockers → Serious
    const pMinor = md.indexOf('\n## Trivial')
    const pCrit  = md.indexOf('\n## Blockers')
    const pMajor = md.indexOf('\n## Serious')
    expect(pMinor).toBeGreaterThan(-1)
    expect(pCrit).toBeGreaterThan(-1)
    expect(pMajor).toBeGreaterThan(-1)
    expect(pMinor).toBeLessThan(pCrit)
    expect(pCrit).toBeLessThan(pMajor)
  })
})
