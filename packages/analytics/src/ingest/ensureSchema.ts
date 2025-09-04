import type Database from "better-sqlite3";

export function ensureSchema(db: Database) {
  const row = db.prepare(`PRAGMA user_version`).get() as { user_version: number };
  const v = Number(row?.user_version || 0);

  db.exec(`PRAGMA foreign_keys = ON;`);

  if (v < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        run_id TEXT PRIMARY KEY,
        ts_start INTEGER,
        ts_finish INTEGER,
        project_id TEXT,
        provider TEXT,
        profile TEXT,
        env TEXT,
        privacy TEXT,
        commit_sha TEXT,
        branch TEXT,
        duration_ms INTEGER,
        findings_total INTEGER,
        critical INTEGER,
        major INTEGER,
        minor INTEGER,
        info INTEGER
      );
      CREATE TABLE IF NOT EXISTS findings (
        finding_id TEXT PRIMARY KEY,
        run_id TEXT,
        ts INTEGER,
        rule_id TEXT,
        severity TEXT,
        file_hash TEXT,
        locator TEXT,
        signals TEXT,
        FOREIGN KEY(run_id) REFERENCES runs(run_id)
      );
      CREATE INDEX IF NOT EXISTS idx_findings_run  ON findings(run_id);
      CREATE INDEX IF NOT EXISTS idx_findings_rule ON findings(rule_id);
      CREATE INDEX IF NOT EXISTS idx_findings_sev  ON findings(severity);
    `);
    db.exec(`PRAGMA user_version = 1;`);
  }

  // v2: VIEW’ы для отчётов
  if (v < 2) {
    db.exec(`
      DROP VIEW IF EXISTS v_runs_last;
      CREATE VIEW v_runs_last AS
      SELECT r.*
      FROM runs r
      ORDER BY r.ts_start DESC;

      DROP VIEW IF EXISTS v_daily_trend;
      CREATE VIEW v_daily_trend AS
      SELECT
        strftime('%Y-%m-%d', datetime(ts/1000, 'unixepoch')) AS ymd,
        COUNT(DISTINCT run_id) AS runs,
        COUNT(*) AS findings,
        SUM(CASE WHEN severity='critical' THEN 1 ELSE 0 END) AS critical,
        SUM(CASE WHEN severity='major'    THEN 1 ELSE 0 END) AS major,
        SUM(CASE WHEN severity='minor'    THEN 1 ELSE 0 END) AS minor,
        SUM(CASE WHEN severity='info'     THEN 1 ELSE 0 END) AS info
      FROM findings
      GROUP BY ymd
      ORDER BY ymd DESC;

      DROP VIEW IF EXISTS v_top_rules;
      CREATE VIEW v_top_rules AS
      SELECT
        rule_id,
        COUNT(*) AS cnt,
        SUM(CASE WHEN severity='critical' THEN 1 ELSE 0 END) AS critical,
        SUM(CASE WHEN severity='major'    THEN 1 ELSE 0 END) AS major,
        SUM(CASE WHEN severity='minor'    THEN 1 ELSE 0 END) AS minor,
        SUM(CASE WHEN severity='info'     THEN 1 ELSE 0 END) AS info
      FROM findings
      GROUP BY rule_id
      ORDER BY cnt DESC;

      DROP VIEW IF EXISTS v_severity_totals;
      CREATE VIEW v_severity_totals AS
      SELECT
        COUNT(*) AS findings,
        SUM(CASE WHEN severity='critical' THEN 1 ELSE 0 END) AS critical,
        SUM(CASE WHEN severity='major'    THEN 1 ELSE 0 END) AS major,
        SUM(CASE WHEN severity='minor'    THEN 1 ELSE 0 END) AS minor,
        SUM(CASE WHEN severity='info'     THEN 1 ELSE 0 END) AS info
      FROM findings;
    `);
    db.exec(`PRAGMA user_version = 2;`);
  }
}
