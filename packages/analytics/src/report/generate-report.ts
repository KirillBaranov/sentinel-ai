import Database from "better-sqlite3";
import fs from "node:fs"
import path from "node:path"
import { cyan, dim, bold, green } from "colorette"
import { parseSinceMs } from "../ingest/sqlite";
import { ensureDirForFile } from "../lib/fs";

export type RunRow = {
  run_id: string; ts_start: number; ts_finish?: number;
  project_id: string; provider: string; profile: string; env: string; privacy?: string;
  duration_ms?: number;
  findings_total?: number; critical?: number; major?: number; minor?: number; info?: number;
};

type Fmt = "csv" | "json";

export interface ExportOptions {
  dbPath: string;           // путь к SQLite (.sentinel/analytics/analytics.db)
  outDir: string;           // каталог для экспорта
  format?: Fmt;             // csv|json (по умолчанию csv)
  since?: string;           // YYYY-MM-DD (UTC полночь)
  days?: number;            // окно для тренда по дням (по умолчанию 30)
  limit?: number;           // лимит для топов/последних запусков (по умолчанию 50)
}

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

export async function printTop(opts: { dbPath: string; since?: string; limit?: number }) {
  const db = new Database(opts.dbPath, { readonly: true })
  const limit = opts.limit ?? 10
  // since в формате '30d' → unixms порог:
  const sinceMs = parseSinceExpr(opts.since || "30d")
  const rows = db.prepare(
    `SELECT rule_id, COUNT(*) as cnt
     FROM findings
     WHERE (@sinceMs IS NULL OR ts >= @sinceMs)
     GROUP BY rule_id
     ORDER BY cnt DESC
     LIMIT @limit`
  ).all({ sinceMs, limit })

  console.log(bold("Top rules"))
  for (const r of rows) console.log("  •", r.rule_id, dim(`(${r.cnt})`))
  db.close()
}

export async function printTrend(opts: { dbPath: string; since?: string }) {
  const db = new Database(opts.dbPath, { readonly: true })
  const sinceMs = parseSinceExpr(opts.since || "14d")
  const rows = db.prepare(
    `SELECT date(datetime(ts/1000,'unixepoch')) AS day, severity, COUNT(*) AS cnt
     FROM findings
     WHERE (@sinceMs IS NULL OR ts >= @sinceMs)
     GROUP BY day, severity
     ORDER BY day`
  ).all({ sinceMs })

  console.log(bold("Trend (daily by severity)"))
  const grouped: Record<string, Record<string, number>> = {}
  for (const r of rows) {
    grouped[r.day] ??= { critical:0, major:0, minor:0, info:0 }
    grouped![r.day]![r.severity] = r.cnt
  }
  Object.entries(grouped).forEach(([day, s]) => {
    console.log("  " + cyan(day) + "  " + `crit ${s.critical} | major ${s.major} | minor ${s.minor} | info ${s.info}`)
  })
  db.close()
}

function toCSV(rows: any[]): string {
  if (!rows?.length) return "";
  const headers = Array.from(
    rows.reduce((set, r) => { Object.keys(r).forEach(k => set.add(k)); return set; }, new Set<string>())
  );
  const esc = (v: any) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = headers.join(",");
  const body = rows.map(r => headers.map(h => esc(r[h as any])).join(",")).join("\n");
  return head + "\n" + body + "\n";
}

function writeFile(outDir: string, name: string, fmt: Fmt, rowsOrObj: any): string {
  ensureDirForFile(outDir);
  const file = path.join(outDir, `${name}.${fmt}`);
  if (fmt === "json") {
    fs.writeFileSync(file, JSON.stringify(rowsOrObj, null, 2), "utf8");
  } else {
    const rows = Array.isArray(rowsOrObj) ? rowsOrObj : [rowsOrObj];
    fs.writeFileSync(file, toCSV(rows), "utf8");
  }
  return file;
}

/**
 * Экспортирует стандартные представления в outDir:
 *  - runs_last         — последние запуски (LIMIT)
 *  - trend_days        — тренд по дням (за days)
 *  - top_rules         — топ правил (LIMIT)
 *  - top_files         — топ файлов (по file_hash, LIMIT)
 *  - severity_totals   — суммарно по severity
 */
export function exportViews(opts: ExportOptions): {
  files: string[];
  meta: { sinceMs?: number; limit: number; days: number; format: Fmt };
} {
  const fmt: Fmt = (opts.format ?? "csv");
  const limit = Number.isFinite(opts.limit as number) ? (opts.limit as number) : 50;
  const days  = Number.isFinite(opts.days as number)  ? (opts.days as number)  : 30;
  const sinceMs = parseSinceMs(opts.since);

  ensureDirForFile(path.dirname(opts.dbPath));
  ensureDirForFile(opts.outDir);

  // Если БД нет — создаём пустые артефакты, чтобы пайплайн не падал.
  if (!fs.existsSync(opts.dbPath)) {
    const emptyFiles = [
      writeFile(opts.outDir, "runs_last",       fmt, []),
      writeFile(opts.outDir, "trend_days",      fmt, []),
      writeFile(opts.outDir, "top_rules",       fmt, []),
      writeFile(opts.outDir, "top_files",       fmt, []),
      writeFile(opts.outDir, "severity_totals", fmt, [{ findings: 0, critical: 0, major: 0, minor: 0, info: 0 }]),
    ];
    return { files: emptyFiles, meta: { sinceMs, limit, days, format: fmt } };
  }

  const db = new Database(opts.dbPath, { readonly: true });

  try {
    // 1) Последние запуски
    const runsStmt = db.prepare(`
      SELECT
        run_id, ts_start, ts_finish, project_id, provider, profile, env, privacy,
        duration_ms, findings_total, critical, major, minor, info
      FROM runs
      ${sinceMs ? "WHERE ts_start >= @since" : ""}
      ORDER BY ts_start DESC
      LIMIT @limit
    `);
    const runs = runsStmt.all({ since: sinceMs, limit });

    // 2) Тренд по дням
    const trendStmt = db.prepare(`
      SELECT
        date(ts/1000, 'unixepoch') AS ymd,
        COUNT(*)                              AS findings,
        SUM(CASE WHEN severity='critical' THEN 1 ELSE 0 END) AS critical,
        SUM(CASE WHEN severity='major'    THEN 1 ELSE 0 END) AS major,
        SUM(CASE WHEN severity='minor'    THEN 1 ELSE 0 END) AS minor,
        SUM(CASE WHEN severity='info'     THEN 1 ELSE 0 END) AS info,
        COUNT(DISTINCT run_id) AS runs
      FROM findings
      ${sinceMs ? "WHERE ts >= @since" : ""}
      GROUP BY ymd
      ORDER BY ymd DESC
      LIMIT @days
    `);
    const trend = trendStmt.all({ since: sinceMs, days });

    // 3) Топ правил
    const topRulesStmt = db.prepare(`
      SELECT
        rule_id,
        COUNT(*) AS cnt,
        SUM(CASE WHEN severity='critical' THEN 1 ELSE 0 END) AS critical,
        SUM(CASE WHEN severity='major'    THEN 1 ELSE 0 END) AS major,
        SUM(CASE WHEN severity='minor'    THEN 1 ELSE 0 END) AS minor,
        SUM(CASE WHEN severity='info'     THEN 1 ELSE 0 END) AS info
      FROM findings
      ${sinceMs ? "WHERE ts >= @since" : ""}
      GROUP BY rule_id
      ORDER BY cnt DESC
      LIMIT @limit
    `);
    const topRules = topRulesStmt.all({ since: sinceMs, limit });

    // 4) Топ файлов по хешу
    const topFilesStmt = db.prepare(`
      SELECT
        file_hash,
        COUNT(*) AS cnt,
        SUM(CASE WHEN severity='critical' THEN 1 ELSE 0 END) AS critical,
        SUM(CASE WHEN severity='major'    THEN 1 ELSE 0 END) AS major,
        SUM(CASE WHEN severity='minor'    THEN 1 ELSE 0 END) AS minor,
        SUM(CASE WHEN severity='info'     THEN 1 ELSE 0 END) AS info
      FROM findings
      ${sinceMs ? "WHERE ts >= @since" : ""}
      GROUP BY file_hash
      ORDER BY cnt DESC
      LIMIT @limit
    `);
    const topFiles = topFilesStmt.all({ since: sinceMs, limit });

    // 5) Суммарная разбивка по severity
    const totalsStmt = db.prepare(`
      SELECT
        COUNT(*) AS findings,
        SUM(CASE WHEN severity='critical' THEN 1 ELSE 0 END) AS critical,
        SUM(CASE WHEN severity='major'    THEN 1 ELSE 0 END) AS major,
        SUM(CASE WHEN severity='minor'    THEN 1 ELSE 0 END) AS minor,
        SUM(CASE WHEN severity='info'     THEN 1 ELSE 0 END) AS info
      FROM findings
      ${sinceMs ? "WHERE ts >= @since" : ""}
    `);
    const totals =
      totalsStmt.get({ since: sinceMs }) ??
      { findings: 0, critical: 0, major: 0, minor: 0, info: 0 };

    // — Записываем файлы
    const files: string[] = [];
    files.push(writeFile(opts.outDir, "runs_last",       fmt, runs));
    files.push(writeFile(opts.outDir, "trend_days",      fmt, trend));
    files.push(writeFile(opts.outDir, "top_rules",       fmt, topRules));
    files.push(writeFile(opts.outDir, "top_files",       fmt, topFiles));
    files.push(writeFile(opts.outDir, "severity_totals", fmt, [totals]));

    return { files, meta: { sinceMs, limit, days, format: fmt } };
  } finally {
    db.close();
  }
}

function parseSinceExpr(expr: string): number | null {
  // 30d / 14d / 6m / 1y, иначе null = без фильтра
  const m = /^(\d+)([dmy])$/.exec(expr.trim())
  if (!m) return null
  const n = Number(m[1]); const unit = m[2]
  const now = Date.now()
  const ms = unit === "d" ? n*864e5 : unit === "m" ? n*30*864e5 : n*365*864e5
  return now - ms
}
function csvSafe(v: any) {
  if (v == null) return ""
  const s = String(v)
  return /[,"\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s
}
