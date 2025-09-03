import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { IngestStats } from "../types";

type Event = {
  v: 1;
  type: "run.started" | "finding.reported" | "run.finished";
  ts: number;
  run_id: string;
  project_id: string;
  provider: string;
  profile: string;
  env: string;
  privacy?: "team" | "detailed";
  commit_sha?: string;
  branch?: string;
  payload?: any;
};

export type IngestOptions = {
  fromDir: string;   // .sentinel/analytics
  dbPath: string;    // .sentinel/analytics/analytics.db
  since?: string;    // YYYY-MM-DD (UTC, опционально)
};

function parseSinceMs(since?: string): number | undefined {
  if (!since) return undefined;
  // интерпретируем как UTC полночь
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(since.trim());
  if (!m) return undefined;
  const y = Number(m[1]), mo = Number(m[2]) - 1, d = Number(m[3]);
  const ms = Date.UTC(y, mo, d, 0, 0, 0, 0);
  return Number.isFinite(ms) ? ms : undefined;
}

export function ingestJsonlToSqlite(opts: IngestOptions): Promise<IngestStats> {
  const stats: IngestStats = {
    fromDir: opts.fromDir,
    dbPath: opts.dbPath,
    since: opts.since,
    filesScanned: 0,
    filesMatched: 0,
    eventsRead: 0,
    eventsValid: 0,
    runsUpserted: 0,
    findingsUpserted: 0,
    duplicatesSkipped: 0,
    firstTs: undefined,
    lastTs: undefined,
  };

  // Если директории нет — просто вернём пустую статистику, создадим директорию БД.
  fs.mkdirSync(path.dirname(opts.dbPath), { recursive: true });
  if (!fs.existsSync(opts.fromDir)) {
    return Promise.resolve(stats);
  }

  const sinceMs = parseSinceMs(opts.since);

  const db = new Database(opts.dbPath);
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");

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
        signals TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_findings_run ON findings(run_id);
      CREATE INDEX IF NOT EXISTS idx_findings_rule ON findings(rule_id);
      CREATE INDEX IF NOT EXISTS idx_findings_sev  ON findings(severity);
    `);

    const upsertRunStart = db.prepare(`
      INSERT INTO runs(run_id, ts_start, project_id, provider, profile, env, privacy, commit_sha, branch)
      VALUES (@run_id, @ts, @project_id, @provider, @profile, @env, @privacy, @commit_sha, @branch)
      ON CONFLICT(run_id) DO UPDATE SET
        ts_start=excluded.ts_start,
        project_id=excluded.project_id,
        provider=excluded.provider,
        profile=excluded.profile,
        env=excluded.env,
        privacy=excluded.privacy,
        commit_sha=excluded.commit_sha,
        branch=excluded.branch
    `);

    const upsertRunFinish = db.prepare(`
      UPDATE runs SET
        ts_finish=@ts,
        duration_ms=@duration_ms,
        findings_total=@findings_total,
        critical=@critical,
        major=@major,
        minor=@minor,
        info=@info
      WHERE run_id=@run_id
    `);

    const insertFinding = db.prepare(`
      INSERT INTO findings(finding_id, run_id, ts, rule_id, severity, file_hash, locator, signals)
      VALUES (@finding_id, @run_id, @ts, @rule_id, @severity, @file_hash, @locator, @signals)
      ON CONFLICT(finding_id) DO NOTHING
    `);

    const filesAll = fs.readdirSync(opts.fromDir).filter(f => f.endsWith(".jsonl"));
    stats.filesScanned = filesAll.length;

    // byDay файлы имеют имя YYYY-MM-DD.jsonl — их можно заранее отфильтровать по имени,
    // но для надёжности всё равно дополнительно фильтруем по ts внутри событий.
    const dayNameCut =
      opts.since ? filesAll.filter(f => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f) && f >= `${opts.since}.jsonl`) : filesAll;

    const tx = db.transaction(() => {
      for (const f of dayNameCut) {
        const abs = path.join(opts.fromDir, f);
        const raw = fs.readFileSync(abs, "utf8");
        if (!raw) continue;

        let fileHasAnyAccepted = false;
        const lines = raw.split(/\r?\n/).filter(Boolean);
        stats.eventsRead += lines.length;

        for (const line of lines) {
          let e: Event | undefined;
          try { e = JSON.parse(line); } catch { continue; }
          if (!e || e.v !== 1) continue;

          // Фильтр по since — на уровне событий (UTC ms)
          if (typeof sinceMs === "number" && typeof e.ts === "number" && e.ts < sinceMs) {
            continue;
          }

          // окно по ts
          if (typeof e.ts === "number") {
            if (stats.firstTs == null || e.ts < stats.firstTs) stats.firstTs = e.ts;
            if (stats.lastTs == null  || e.ts > stats.lastTs)  stats.lastTs = e.ts;
          }

          if (e.type === "run.started") {
            const info = upsertRunStart.run({
              run_id: e.run_id,
              ts: e.ts,
              project_id: e.project_id,
              provider: e.provider,
              profile: e.profile,
              env: e.env,
              privacy: e.privacy ?? null,
              commit_sha: e.commit_sha ?? null,
              branch: e.branch ?? null,
            });
            // INSERT or UPDATE → считаем как валидную обработку
            if (info.changes > 0) stats.runsUpserted += 1;
            stats.eventsValid += 1;
            fileHasAnyAccepted = true;

          } else if (e.type === "finding.reported") {
            const p = e.payload || {};
            const info = insertFinding.run({
              finding_id: p.finding_id,
              run_id: e.run_id,
              ts: e.ts,
              rule_id: p.rule_id,
              severity: p.severity,
              file_hash: p.file_hash,
              locator: p.locator,
              signals: p.signals ? JSON.stringify(p.signals) : null,
            });
            if (info.changes > 0) {
              stats.findingsUpserted += 1;
            } else {
              stats.duplicatesSkipped += 1; // PK конфликт → дубль
            }
            stats.eventsValid += 1;
            fileHasAnyAccepted = true;

          } else if (e.type === "run.finished") {
            const p = e.payload || {};
            const info = upsertRunFinish.run({
              run_id: e.run_id,
              ts: e.ts,
              duration_ms: p.duration_ms ?? null,
              findings_total: p.findings_total ?? null,
              critical: p.findings_by_severity?.critical ?? 0,
              major:    p.findings_by_severity?.major ?? 0,
              minor:    p.findings_by_severity?.minor ?? 0,
              info:     p.findings_by_severity?.info ?? 0,
            });
            // UPDATE может не менять строку (changes=0), но событие валидно
            stats.eventsValid += 1;
            fileHasAnyAccepted = true;
          }
        }

        if (fileHasAnyAccepted) stats.filesMatched += 1;
      }
    });

    tx();
  } finally {
    db.close();
  }

  return Promise.resolve(stats);
}
