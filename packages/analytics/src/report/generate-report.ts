import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { cyan, dim, bold } from "colorette";
import { ensureSchema } from "../ingest/ensureSchema";

// ──────────────────────────────────────────────────────────────────────────────
// Типы
// ──────────────────────────────────────────────────────────────────────────────
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

export type DailyTrendRow = {
  ymd: string; runs: number; findings: number;
  critical: number; major: number; minor: number; info: number;
};

export type TopRuleRow = {
  rule_id: string; cnt: number; major: number; minor: number; info: number; critical: number;
};

export type SeverityTotalRow = {
  critical: number; major: number; minor: number; info: number; findings: number;
};

// ──────────────────────────────────────────────────────────────────────────────
// Локальные парсеры временных параметров
// ──────────────────────────────────────────────────────────────────────────────

/** "YYYY-MM-DD" → UTC unix ms @ 00:00:00 */
function parseSinceMs(since?: string): number | undefined {
  if (!since) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(since.trim());
  if (!m) return undefined;
  const y = Number(m[1]), mo = Number(m[2]) - 1, d = Number(m[3]);
  const ms = Date.UTC(y, mo, d, 0, 0, 0, 0);
  return Number.isFinite(ms) ? ms : undefined;
}

/** "30d" / "6m" / "1y" → unix ms порог (сейчас - окно) */
function parseSinceExpr(expr?: string): number | null {
  if (!expr) return null;
  const m = /^(\d+)([dmy])$/.exec(expr.trim());
  if (!m) return null;
  const n = Number(m[1]); const unit = m[2];
  const now = Date.now();
  const ms = unit === "d" ? n * 864e5 : unit === "m" ? n * 30 * 864e5 : n * 365 * 864e5;
  return now - ms;
}

/** unix ms → "YYYY-MM-DD" (UTC) */
function msToYmdUTC(ms: number): string {
  const d = new Date(ms);
  return [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, "0"),
    String(d.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

// ──────────────────────────────────────────────────────────────────────────────
// Простые запросы (используют VIEW’ы, где это возможно)
// ──────────────────────────────────────────────────────────────────────────────

export function queryLastRuns(dbPath: string, limit = 10): RunRow[] {
  const db = new Database(dbPath, { readonly: true });
  ensureSchema(db);
  const rows = db.prepare(`SELECT * FROM v_runs_last LIMIT ?`).all(limit) as RunRow[];
  db.close();
  return rows;
}

export function queryDailyTrend(dbPath: string, days = 14): DailyTrendRow[] {
  const db = new Database(dbPath, { readonly: true });
  ensureSchema(db);
  const rows = db.prepare(`
    SELECT * FROM v_daily_trend
    ORDER BY ymd DESC
    LIMIT ?
  `).all(days) as DailyTrendRow[];
  db.close();
  // хотим возрастающий порядок слева-направо
  return rows.reverse();
}

export function queryTopRules(dbPath: string, limit = 10): TopRuleRow[] {
  const db = new Database(dbPath, { readonly: true });
  ensureSchema(db);
  const rows = db.prepare(`
    SELECT * FROM v_top_rules
    LIMIT ?
  `).all(limit) as TopRuleRow[];
  db.close();
  return rows;
}

export function querySeverityTotals(dbPath: string): SeverityTotalRow {
  const db = new Database(dbPath, { readonly: true });
  ensureSchema(db);
  const row = db.prepare(`SELECT * FROM v_severity_totals`).get() as SeverityTotalRow;
  db.close();
  return row || { critical: 0, major: 0, minor: 0, info: 0, findings: 0 };
}

// ──────────────────────────────────────────────────────────────────────────────
export async function printTop(opts: { dbPath: string; since?: string; limit?: number }) {
  const db = new Database(opts.dbPath, { readonly: true });
  ensureSchema(db);

  const limit = opts.limit ?? 10;
  const sinceMs = parseSinceExpr(opts.since || "30d");

  // если есть since — считаем по таблице findings с WHERE
  // иначе — читаем из v_top_rules (быстрее)
  const rows = sinceMs
    ? db.prepare(
        `SELECT rule_id, COUNT(*) AS cnt
         FROM findings
         WHERE ts >= @since
         GROUP BY rule_id
         ORDER BY cnt DESC
         LIMIT @limit`
      ).all({ since: sinceMs, limit })
    : db.prepare(
        `SELECT rule_id, cnt FROM v_top_rules
         LIMIT @limit`
      ).all({ limit });

  console.log(bold("Top rules"));
  for (const r of rows as Array<{ rule_id: string; cnt: number }>) {
    console.log("  •", r.rule_id, dim(`(${r.cnt})`));
  }
  db.close();
}

export async function printTrend(opts: { dbPath: string; since?: string }) {
  const db = new Database(opts.dbPath, { readonly: true });
  ensureSchema(db);

  const sinceMs = parseSinceExpr(opts.since || "14d");
  if (sinceMs) {
    // фильтруем по дате от YMD
    const ymd = msToYmdUTC(sinceMs);
    const rows = db.prepare(
      `SELECT * FROM v_daily_trend
       WHERE ymd >= @ymd
       ORDER BY ymd`
    ).all({ ymd }) as DailyTrendRow[];

    console.log(bold("Trend (daily by severity)"));
    for (const r of rows) {
      console.log(
        "  " + cyan(r.ymd) + "  " +
        `crit ${r.critical} | major ${r.major} | minor ${r.minor} | info ${r.info}`
      );
    }
  } else {
    const rows = db.prepare(
      `SELECT * FROM v_daily_trend ORDER BY ymd`
    ).all() as DailyTrendRow[];

    console.log(bold("Trend (daily by severity)"));
    for (const r of rows) {
      console.log(
        "  " + cyan(r.ymd) + "  " +
        `crit ${r.critical} | major ${r.major} | minor ${r.minor} | info ${r.info}`
      );
    }
  }

  db.close();
}

// ──────────────────────────────────────────────────────────────────────────────
// Экспорт стандартных представлений
// ──────────────────────────────────────────────────────────────────────────────

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

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeFile(outDir: string, name: string, fmt: Fmt, rowsOrObj: any): string {
  ensureDir(outDir);
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

  ensureDir(path.dirname(opts.dbPath));
  ensureDir(opts.outDir);

  // Если БД нет — пишем пустые артефакты, чтобы пайплайн не падал.
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
  ensureSchema(db);

  try {
    // 1) Последние запуски
    const runs = db.prepare(`
      SELECT
        run_id, ts_start, ts_finish, project_id, provider, profile, env, privacy,
        duration_ms, findings_total, critical, major, minor, info
      FROM v_runs_last
      ${sinceMs ? "WHERE ts_start >= @since" : ""}
      LIMIT @limit
    `).all({ since: sinceMs, limit });

    // 2) Тренд по дням
    const trend = sinceMs
      ? db.prepare(`
          SELECT * FROM v_daily_trend
          WHERE ymd >= @ymd
          ORDER BY ymd DESC
          LIMIT @days
        `).all({ ymd: msToYmdUTC(sinceMs), days })
      : db.prepare(`
          SELECT * FROM v_daily_trend
          ORDER BY ymd DESC
          LIMIT @days
        `).all({ days });

    // 3) Топ правил
    const topRules = sinceMs
      ? db.prepare(`
          SELECT
            rule_id,
            COUNT(*) AS cnt,
            SUM(CASE WHEN severity='critical' THEN 1 ELSE 0 END) AS critical,
            SUM(CASE WHEN severity='major'    THEN 1 ELSE 0 END) AS major,
            SUM(CASE WHEN severity='minor'    THEN 1 ELSE 0 END) AS minor,
            SUM(CASE WHEN severity='info'     THEN 1 ELSE 0 END) AS info
          FROM findings
          WHERE ts >= @since
          GROUP BY rule_id
          ORDER BY cnt DESC
          LIMIT @limit
        `).all({ since: sinceMs, limit })
      : db.prepare(`SELECT * FROM v_top_rules LIMIT @limit`).all({ limit });

    // 4) Топ файлов по хешу
    const topFiles = sinceMs
      ? db.prepare(`
          SELECT
            file_hash,
            COUNT(*) AS cnt,
            SUM(CASE WHEN severity='critical' THEN 1 ELSE 0 END) AS critical,
            SUM(CASE WHEN severity='major'    THEN 1 ELSE 0 END) AS major,
            SUM(CASE WHEN severity='minor'    THEN 1 ELSE 0 END) AS minor,
            SUM(CASE WHEN severity='info'     THEN 1 ELSE 0 END) AS info
          FROM findings
          WHERE ts >= @since
          GROUP BY file_hash
          ORDER BY cnt DESC
          LIMIT @limit
        `).all({ since: sinceMs, limit })
      : db.prepare(`
          SELECT
            file_hash,
            COUNT(*) AS cnt,
            SUM(CASE WHEN severity='critical' THEN 1 ELSE 0 END) AS critical,
            SUM(CASE WHEN severity='major'    THEN 1 ELSE 0 END) AS major,
            SUM(CASE WHEN severity='minor'    THEN 1 ELSE 0 END) AS minor,
            SUM(CASE WHEN severity='info'     THEN 1 ELSE 0 END) AS info
          FROM findings
          GROUP BY file_hash
          ORDER BY cnt DESC
          LIMIT @limit
        `).all({ limit });

    // 5) Суммарная разбивка по severity
    const totals = sinceMs
      ? db.prepare(`
          SELECT
            COUNT(*) AS findings,
            SUM(CASE WHEN severity='critical' THEN 1 ELSE 0 END) AS critical,
            SUM(CASE WHEN severity='major'    THEN 1 ELSE 0 END) AS major,
            SUM(CASE WHEN severity='minor'    THEN 1 ELSE 0 END) AS minor,
            SUM(CASE WHEN severity='info'     THEN 1 ELSE 0 END) AS info
          FROM findings
          WHERE ts >= @since
        `).get({ since: sinceMs }) ?? { findings: 0, critical: 0, major: 0, minor: 0, info: 0 }
      : db.prepare(`SELECT * FROM v_severity_totals`).get() ?? { findings: 0, critical: 0, major: 0, minor: 0, info: 0 };

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
