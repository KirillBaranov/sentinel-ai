import Database from "better-sqlite3";

export type RunRow = {
  run_id: string; ts_start: number; ts_finish?: number;
  project_id: string; provider: string; profile: string; env: string; privacy?: string;
  duration_ms?: number;
  findings_total?: number; critical?: number; major?: number; minor?: number; info?: number;
};

export function queryLastRuns(dbPath: string, limit = 10): RunRow[] {
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare(`
    SELECT * FROM runs ORDER BY ts_start DESC LIMIT ?
  `).all(limit) as RunRow[];
  db.close();
  return rows;
}

export type DailyTrendRow = {
  ymd: string; runs: number; findings: number;
  critical: number; major: number; minor: number; info: number;
};

export function queryDailyTrend(dbPath: string, days = 14): DailyTrendRow[] {
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare(`
    SELECT
      STRFTIME('%Y-%m-%d', ts_start/1000, 'unixepoch') AS ymd,
      COUNT(*) AS runs,
      SUM(COALESCE(findings_total,0)) AS findings,
      SUM(COALESCE(critical,0)) AS critical,
      SUM(COALESCE(major,0))    AS major,
      SUM(COALESCE(minor,0))    AS minor,
      SUM(COALESCE(info,0))     AS info
    FROM runs
    GROUP BY ymd
    ORDER BY ymd DESC
    LIMIT ?
  `).all(days) as DailyTrendRow[];
  db.close();
  return rows.reverse();
}

export type TopRuleRow = {
  rule_id: string; cnt: number; major: number; minor: number; info: number; critical: number;
};

export function queryTopRules(dbPath: string, limit = 10): TopRuleRow[] {
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare(`
    SELECT rule_id,
           COUNT(*) AS cnt,
           SUM(CASE WHEN severity='critical' THEN 1 ELSE 0 END) AS critical,
           SUM(CASE WHEN severity='major'    THEN 1 ELSE 0 END) AS major,
           SUM(CASE WHEN severity='minor'    THEN 1 ELSE 0 END) AS minor,
           SUM(CASE WHEN severity='info'     THEN 1 ELSE 0 END) AS info
    FROM findings
    GROUP BY rule_id
    ORDER BY cnt DESC
    LIMIT ?
  `).all(limit) as TopRuleRow[];
  db.close();
  return rows;
}

export type SeverityTotalRow = {
  critical: number; major: number; minor: number; info: number; findings: number;
};

export function querySeverityTotals(dbPath: string): SeverityTotalRow {
  const db = new Database(dbPath, { readonly: true });
  const row = db.prepare(`
    SELECT
      SUM(COALESCE(critical,0)) AS critical,
      SUM(COALESCE(major,0))    AS major,
      SUM(COALESCE(minor,0))    AS minor,
      SUM(COALESCE(info,0))     AS info,
      SUM(COALESCE(findings_total,0)) AS findings
    FROM runs
  `).get() as SeverityTotalRow;
  db.close();
  return row || { critical:0, major:0, minor:0, info:0, findings:0 };
}
