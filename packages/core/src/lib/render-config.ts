import type { Severity } from './types';

export interface SeverityMap {
  title: Record<Severity, string>;
  icon?: Record<Severity, string>;
  order?: Severity[];
}

export interface RenderOptions {
  severityMap?: SeverityMap;
  template?: string;
  locale?: string;
  compactMeta?: boolean;
}

export const DEFAULT_SEVERITY_MAP: SeverityMap = {
  title: {
    critical: '🛑 Critical',
    major:    '⚠️ Major',
    minor:    '💡 Minor',
    info:     '🛈 Info'
  },
  order: ['critical','major','minor','info']
};
