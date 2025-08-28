import { FileDiff, ReviewFinding, ReviewJson, makeFingerprint } from '../../core/src/lib/normalize.js';
import { hunkLocator } from '../../core/src/lib/diff.js';

export function runMockProvider(opts: {
  runId: string;
  profile: 'frontend';
  rules: { id: string; severity: string }[];
  diffs: FileDiff[];
}): ReviewJson {
  const findings: ReviewFinding[] = [];
  const hasRule = (id: string) => opts.rules.some(r => r.id === id);

  for (const fd of opts.diffs) {
    for (const h of fd.hunks) {
      if (hasRule('style.no-todo-comment')) {
        const todos = h.added.filter(a => /\bTODO\b/i.test(a.text));
        if (todos.length) {
          const locator = hunkLocator(h);
          const list = todos.map(t => `[L${t.line}] TODO comment detected`);
          const fingerprint = makeFingerprint('style.no-todo-comment', fd.filePath, locator, list[0]);
          findings.push({
            rule: 'style.no-todo-comment',
            severity: 'minor',
            file: fd.filePath,
            locator,
            finding: list,
            why: 'TODO comments create tech debt noise (see style handbook).',
            suggestion: 'Replace with an issue reference; avoid TODO.',
            fingerprint
          });
        }
      }
      if (hasRule('arch.modular-boundaries')) {
        const cross = h.added.filter(a => /from\s+['"]feature-b\//.test(a.text) || /import\s+.*['"]feature-b\//.test(a.text));
        if (cross.length) {
          const locator = hunkLocator(h);
          const list = cross.map(t => `[L${t.line}] Cross-feature import to feature-b detected`);
          const fingerprint = makeFingerprint('arch.modular-boundaries', fd.filePath, locator, list[0]);
          findings.push({
            rule: 'arch.modular-boundaries',
            severity: 'critical',
            file: fd.filePath,
            locator,
            finding: list,
            why: 'Violates module boundaries: features must not import other features directly.',
            suggestion: 'Introduce a shared adapter in src/shared/ports.',
            fingerprint
          });
        }
      }
    }
  }

  return { ai_review: { version: 1, run_id: opts.runId, findings } };
}
