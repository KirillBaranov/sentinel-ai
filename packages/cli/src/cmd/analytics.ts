import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { bold, cyan, dim, green, red, yellow } from "colorette";
import { findRepoRoot, linkifyFile } from "../cli-utils";
import { loadConfig } from "../config";
import {
  ingestJsonlToSqlite,
  printLastRunSummary,
  printTop,
  exportViews,
  printTrend,
  queryLastRuns,
  queryDailyTrend,
  queryTopRules,
  querySeverityTotals,
  migrate
} from "@sentinel/analytics";

const REPO = findRepoRoot();
const RC = loadConfig(); // ← читаем единый rc один раз

// дефолты из rc (всё уже абсолютное)
const DEFAULT_FROM = RC.out.analyticsDirAbs;
const DEFAULT_DB   = path.join(RC.out.analyticsDirAbs, "analytics.db");
const DEFAULT_EXP  = RC.out.exportsDirAbs;

function prettyRel(repo: string, abs: string) {
  return `${dim(path.relative(repo, abs))} ${cyan("→")} ${dim(linkifyFile(abs))}`;
}

export function registerAnalyticsCommands(program: Command) {
  // 1) Ingest
  program
    .command("analytics:ingest")
    .description("Ingest JSONL analytics into SQLite db (idempotent)")
    .option("--from <dir>", "directory with jsonl", DEFAULT_FROM)
    .option("--db <file>",  "sqlite db file",       DEFAULT_DB)
    .option("--since <ymd>", "YYYY-MM-DD filter")
    .action(async (opts) => {
      const fromDir = path.isAbsolute(opts.from) ? opts.from : path.join(RC.repoRoot, opts.from);
      const dbPath  = path.isAbsolute(opts.db)   ? opts.db   : path.join(RC.repoRoot, opts.db);
      const since   = opts.since as string | undefined;

      const started = Date.now();
      console.log(bold("Analytics Ingest"));
      console.log("  " + cyan("from: ") + prettyRel(REPO, fromDir));
      console.log("  " + cyan("db:   ") + prettyRel(REPO, dbPath));
      if (since) console.log("  " + cyan("since:") + " " + since);

      try {
        const stats: any = await ingestJsonlToSqlite({ fromDir, dbPath, since });

        if (stats && typeof stats === "object") {
          const dur = Date.now() - started;
          console.log("");
          console.log(bold("Ingest stats"));
          console.log("  " + cyan("files:    ")
            + `${stats.filesMatched ?? stats.filesScanned ?? 0}`
            + (typeof stats.filesScanned === "number" ? dim(` / scanned ${stats.filesScanned}`) : ""));
          console.log("  " + cyan("events:   ")
            + `${stats.eventsValid ?? stats.eventsRead ?? 0}`
            + (typeof stats.eventsRead === "number" ? dim(` / read ${stats.eventsRead}`) : ""));
          console.log("  " + cyan("upserted: ")
            + `runs ${stats.runsUpserted ?? 0}, findings ${stats.findingsUpserted ?? 0}`);
          if (typeof stats.duplicatesSkipped === "number") {
            console.log("  " + cyan("skipped:  ") + `${stats.duplicatesSkipped} ` + dim("(duplicates)"));
          }
          if (stats.firstTs || stats.lastTs) {
            const firstIso = stats.firstTs ? new Date(stats.firstTs).toISOString() : "—";
            const lastIso  = stats.lastTs  ? new Date(stats.lastTs).toISOString()  : "—";
            console.log("  " + cyan("window:   ") + `${firstIso} ${dim("→")} ${lastIso}`);
          }
          console.log("  " + cyan("duration: ") + `${dur} ms`);
          console.log(green("Done."));
        } else {
          console.log(green("Done."));
        }
      } catch (e: any) {
        console.error(red("Failed to ingest: ") + (e?.message || String(e)));
        if (e?.stack) console.error(dim(e.stack));
        process.exit(1);
      }
    });

  // 1.1) Migrate schema/views
  program
    .command("analytics:migrate")
    .description("Create/upgrade SQLite schema and views")
    .option("--db <file>", "sqlite db file", DEFAULT_DB)
    .action(async (opts) => {
      const dbPath = path.isAbsolute(opts.db) ? opts.db : path.join(RC.repoRoot, opts.db);
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      await migrate({ dbPath });
      console.log("migrated → " + dbPath);
    });

  // 2) Print last run
  program
    .command("analytics:print")
    .description("Print last run summary from SQLite")
    .option("--db <file>", "sqlite db file", DEFAULT_DB)
    .action((opts) => {
      const dbPath = path.isAbsolute(opts.db) ? opts.db : path.join(RC.repoRoot, opts.db);
      console.log(bold("Analytics Print"));
      console.log("  " + cyan("db:   ") + prettyRel(REPO, dbPath));

      if (!fs.existsSync(dbPath)) {
        console.log(yellow("DB not found: ") + dim(dbPath));
        process.exit(2);
      }
      try {
        const code = printLastRunSummary({ dbPath, repoRoot: REPO });
        process.exit(code ?? 0);
      } catch (e: any) {
        console.error(red("Failed to print: ") + (e?.message || String(e)));
        if (e?.stack) console.error(dim(e.stack));
        process.exit(1);
      }
    });

  // 3) Stats: runs
  program
    .command("analytics:stats:runs")
    .description("List last N runs")
    .option("--db <file>", "sqlite db file", DEFAULT_DB)
    .option("--limit <n>", "how many", "10")
    .action((opts) => {
      const dbPath = path.isAbsolute(opts.db) ? opts.db : path.join(RC.repoRoot, opts.db);
      const limit  = Number(opts.limit) || 10;
      const rows = queryLastRuns(dbPath, limit);

      console.log(bold("Last Runs"));
      console.log("  " + cyan("db: ") + dim(path.relative(REPO, dbPath)));
      for (const r of rows) {
        const started = new Date(r.ts_start).toISOString();
        const finished = r.ts_finish ? new Date(r.ts_finish).toISOString() : "—";
        console.log(
          ` • ${r.run_id} ${dim(`(${started} → ${finished})`)}\n` +
          `   ${dim(`project ${r.project_id}, profile ${r.profile}, provider ${r.provider}, env ${r.env}`)}\n` +
          `   findings ${r.findings_total ?? 0} ${dim(`(crit ${r.critical ?? 0}, major ${r.major ?? 0}, minor ${r.minor ?? 0}, info ${r.info ?? 0})`)}`
        );
      }
    });

  // 4) Stats: daily trend
  program
    .command("analytics:stats:trend")
    .description("Daily trend for last N days")
    .option("--db <file>", "sqlite db file", DEFAULT_DB)
    .option("--days <n>", "days window", "14")
    .action((opts) => {
      const dbPath = path.isAbsolute(opts.db) ? opts.db : path.join(RC.repoRoot, opts.db);
      const days   = Number(opts.days) || 14;
      const rows = queryDailyTrend(dbPath, days);

      console.log(bold("Daily Trend"));
      console.log("  " + cyan("db:   ") + dim(path.relative(REPO, dbPath)));
      console.log("  " + cyan("days: ") + days);
      for (const r of rows) {
        console.log(
          ` • ${r.ymd}: runs ${r.runs}, findings ${r.findings} ` +
          dim(`(crit ${r.critical}, major ${r.major}, minor ${r.minor}, info ${r.info})`)
        );
      }
    });

  // 5) Stats: top rules
  program
    .command("analytics:stats:top-rules")
    .description("Top rules by findings")
    .option("--db <file>", "sqlite db file", DEFAULT_DB)
    .option("--limit <n>", "how many", "10")
    .action((opts) => {
      const dbPath = path.isAbsolute(opts.db) ? opts.db : path.join(RC.repoRoot, opts.db);
      const limit  = Number(opts.limit) || 10;
      const rows = queryTopRules(dbPath, limit);

      console.log(bold("Top Rules"));
      console.log("  " + cyan("db:    ") + dim(path.relative(REPO, dbPath)));
      console.log("  " + cyan("limit: ") + limit);
      for (const r of rows) {
        console.log(
          ` • ${r.rule_id}: ${r.cnt} ` +
          dim(`(crit ${r.critical}, major ${r.major}, minor ${r.minor}, info ${r.info})`)
        );
      }
    });

  // 6) Stats: severity totals
  program
    .command("analytics:stats:severity")
    .description("Totals by severity (all time)")
    .option("--db <file>", "sqlite db file", DEFAULT_DB)
    .action((opts) => {
      const dbPath = path.isAbsolute(opts.db) ? opts.db : path.join(RC.repoRoot, opts.db);
      const s = querySeverityTotals(dbPath);

      console.log(bold("Severity Totals"));
      console.log("  " + cyan("db:       ") + dim(path.relative(REPO, dbPath)));
      console.log("  " + cyan("findings: ") + (s.findings ?? 0));
      console.log("  " + cyan("critical: ") + (s.critical ?? 0));
      console.log("  " + cyan("major:    ") + (s.major ?? 0));
      console.log("  " + cyan("minor:    ") + (s.minor ?? 0));
      console.log("  " + cyan("info:     ") + (s.info ?? 0));
      console.log(green("OK"));
    });

  // 7) High-level top view
  program
    .command("analytics:top")
    .description("Show top rules/files/providers for a period")
    .option("--db <file>", "sqlite db file", DEFAULT_DB)
    .option("--since <expr>", "period (e.g. 7d, 30d, 90d)", "30d")
    .option("--limit <n>", "top N", "10")
    .action(async (opts) => {
      const dbPath = path.isAbsolute(opts.db) ? opts.db : path.join(RC.repoRoot, opts.db);
      await printTop({ dbPath, since: opts.since, limit: Number(opts.limit) || 10 });
    });

  // 8) High-level trend
  program
    .command("analytics:trend")
    .description("Print daily trend by severity")
    .option("--db <file>", "sqlite db file", DEFAULT_DB)
    .option("--since <expr>", "period (e.g. 14d, 30d, 6m)", "14d")
    .action(async (opts) => {
      const dbPath = path.isAbsolute(opts.db) ? opts.db : path.join(RC.repoRoot, opts.db);
      await printTrend({ dbPath, since: opts.since });
    });

  // 9) Export views
  program
    .command("analytics:export")
    .description("Export key views to CSV/JSON")
    .option("--db <file>",  "sqlite db file", DEFAULT_DB)
    .option("--out <dir>",  "output dir",     DEFAULT_EXP)
    .option("--format <fmt>", "csv|json", "csv")
    .action(async (opts) => {
      const dbPath  = path.isAbsolute(opts.db)  ? opts.db  : path.join(RC.repoRoot, opts.db);
      const outDir  = path.isAbsolute(opts.out) ? opts.out : path.join(RC.repoRoot, opts.out);
      const format  = (opts.format || "csv") as "csv" | "json";
      await exportViews({ dbPath, outDir, format });
      console.log(`exported → ${outDir}`);
    });
}
