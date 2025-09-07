import type { SeverityMap } from '../types';

/**
 * Опции рендера человека-читаемого отчёта.
 * Используются renderMarkdown (и могут использоваться в renderHtml).
 */
export interface RenderOptions {
  /**
   * Кастомный Markdown-шаблон.
   * Если не задан — используется встроенный шаблон.
   */
  template?: string;

  /**
   * Карта тяжестей: заголовки/иконки/порядок сортировки.
   * Если не задана — используется DEFAULT_SEVERITY_MAP внутри рендера.
   */
  severityMap?: SeverityMap;

  /**
   * Необязательный заголовок отчёта (для шаблонов).
   * По умолчанию: "AI Review".
   */
  title?: string;
}
