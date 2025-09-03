import type { Severity, SeverityMap } from '@sentinel/core';
import { DEFAULT_SEVERITY_MAP } from '@sentinel/core';

const SEVERITIES: Severity[] = ['critical', 'major', 'minor', 'info'];

function isSeverity(x: any): x is Severity {
  return SEVERITIES.includes(x);
}

type TitlesOnly = Partial<Record<Severity, string>>;

function looksLikeTitlesOnly(x: unknown): x is TitlesOnly {
  if (!x || typeof x !== 'object') return false;
  // нет поля title → возможно, шорткат
  if ('title' in (x as any)) return false;
  // хотя бы один валидный ключ severity со значением string
  return Object.entries(x as Record<string, unknown>)
    .some(([k, v]) => isSeverity(k as any) && typeof v === 'string');
}

function looksLikeFullMap(x: unknown): x is Partial<SeverityMap> {
  if (!x || typeof x !== 'object') return false;
  return 'title' in (x as any) && typeof (x as any).title === 'object';
}

/**
 * Приводит rc.render.severityMap к каноническому SeverityMap.
 * Поддерживает 2 формы:
 *  1) Полная: { title: {...}, icon?: {...}, order?: [...] }
 *  2) Шорткат: { critical: "…", major: "…", minor: "…", info: "…" }
 */
export function normalizeSeverityMap(input?: unknown): SeverityMap | undefined {
  if (!input) return undefined;

  if (looksLikeFullMap(input)) {
    const full = input as Partial<SeverityMap>;
    const title = {
      ...DEFAULT_SEVERITY_MAP.title,
      ...(full.title || {}),
    };

    const icon = full.icon ?? DEFAULT_SEVERITY_MAP.icon;
    const order = full.order ?? DEFAULT_SEVERITY_MAP.order;

    for (const s of SEVERITIES) {
      if (!title[s]) title[s] = DEFAULT_SEVERITY_MAP.title[s];
    }
    return { title, icon, order };
  }

  // Шорткат: только заголовки
  if (looksLikeTitlesOnly(input)) {
    const t = input as TitlesOnly;
    const title: Record<Severity, string> = { ...DEFAULT_SEVERITY_MAP.title };
    for (const [k, v] of Object.entries(t)) {
      if (isSeverity(k) && typeof v === 'string') title[k] = v;
    }
    return {
      title,
      icon: DEFAULT_SEVERITY_MAP.icon,
      order: DEFAULT_SEVERITY_MAP.order,
    };
  }

  // Некорректный формат
  throw new Error(
    '[config] render.severityMap: invalid format. ' +
    'Use either { title: {critical|major|minor|info: string}, icon?, order? } ' +
    'or a shortcut {critical|major|minor|info: string}.'
  );
}
