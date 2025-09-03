import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { linkifyFile } from "../lib/links";
import { bold, cyan, dim } from "colorette";

// Если нет своей утилиты linkifyFile — можно так:
// const linkifyFile = (abs: string) => new URL(`file://${abs}`).href;

export type LastRunSummary = {
  run_id: string;
  ts_start: number;
  ts_finish?: number | null;
  project_id?: string | null;
  profile?: string | null;
  provider?: string | null;
  env?: string | null;
  privacy?: "team" | "detailed" | null;
  duration_ms?: number | null;
  findings_total?: number | null;
  critical?: number | null;
  major?: number | null;
  minor?: number | null;
  info?: number | null;
};

function openReadonly(dbPath: string): Database {
  // динамический импорт чтобы зависимости/типы не протекали в CLI
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require("better-sqlite3") as unknown as { new (f: string, opts?: any): Database };
  return new Database(dbPath, { readonly: true });
}

export function queryLastRun(dbPath: string): LastRunSummary | null {
  if (!fs.existsSync(dbPath)) return null;
  const db = openReadonly(dbPath);
  try {
    const row = db.prepare<[], LastRunSummary>(`SELECT * FROM runs ORDER BY ts_start DESC LIMIT 1`).get();
    return row ?? null;
  } finally {
    db.close();
  }
}

export function printLastRunSummary(args: {
  dbPath: string;
  repoRoot?: string;      // для красивых относительных путей
  out?: (s: string) => void; // кастомный вывод (по умолчанию console.log)
}) {
  const { dbPath, repoRoot = process.cwd(), out = console.log } = args;

  if (!fs.existsSync(dbPath)) {
    out(dim(`DB not found: ${dbPath}`));
    return 2; // нехардкодим exit, просто возвращаем код
  }

  const last = queryLastRun(dbPath);
  if (!last) {
    out(dim("No runs"));
    return 0;
  }

  out(bold("Last Run"));
  out("  " + cyan("run_id:   ") + last.run_id);
  out("  " + cyan("started:  ") + new Date(last.ts_start).toISOString());
  if (last.ts_finish) out("  " + cyan("finished: ") + new Date(last.ts_finish).toISOString());
  if (last.project_id) out("  " + cyan("project:  ") + last.project_id);
  if (last.profile)    out("  " + cyan("profile:  ") + last.profile);
  if (last.provider)   out("  " + cyan("provider: ") + last.provider);
  if (last.env)        out("  " + cyan("env:      ") + last.env);
  if (last.privacy)    out("  " + cyan("privacy:  ") + last.privacy);
  if (typeof last.duration_ms === "number") out("  " + cyan("duration: ") + `${last.duration_ms} ms`);
  const c = {
    crit:  last.critical ?? 0,
    major: last.major ?? 0,
    minor: last.minor ?? 0,
    info:  last.info ?? 0,
  };
  out("  " + cyan("findings: ") + (last.findings_total ?? 0)
      + dim(` (crit ${c.crit}, major ${c.major}, minor ${c.minor}, info ${c.info})`));

  // маленький бонус: где лежит БД
  const rel = path.relative(repoRoot, dbPath);
  out("  " + cyan("db:      ") + `${rel}  →  ${dim(linkifyFile(dbPath))}`);

  return 0;
}
