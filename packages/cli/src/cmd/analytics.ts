import path from "node:path";
import fs from "node:fs";
import { Command } from "commander";
import { bold, cyan, dim, green, red, yellow } from "colorette";
import { findRepoRoot, linkifyFile } from "../cli-utils";
import { ingestJsonlToSqlite, printLastRunSummary } from "@sentinel/analytics";

import {
  queryLastRuns,
  queryDailyTrend,
  queryTopRules,
  querySeverityTotals
} from "@sentinel/analytics";

const REPO = findRepoRoot();

function prettyRel(repo: string, abs: string) {
  return `${dim(path.relative(repo, abs))} ${cyan("→")} ${dim(linkifyFile(abs))}`;
}

export function registerAnalyticsCommands(program: Command) {
  program
    .command("analytics:ingest")
    .description("Ingest JSONL analytics into SQLite db (idempotent)")
    .option("--from <dir>", "directory with jsonl", path.join(REPO, ".sentinel/analytics"))
    .option("--db <file>",  "sqlite db file", path.join(REPO, ".sentinel/analytics/analytics.db"))
    .option("--since <ymd>", "YYYY-MM-DD filter")
    .action(async (opts) => {
      const fromDir = path.isAbsolute(opts.from) ? opts.from : path.join(REPO, opts.from);
      const dbPath  = path.isAbsolute(opts.db)   ? opts.db   : path.join(REPO, opts.db);
      const since   = opts.since as string | undefined;

      const started = Date.now();
      console.log(bold("Analytics Ingest"));
      console.log("  " + cyan("from: ") + prettyRel(REPO, fromDir));
      console.log("  " + cyan("db:   ") + prettyRel(REPO, dbPath));
      if (since) console.log("  " + cyan("since:") + " " + since);

      try {
        // Может вернуть stats, а может ничего — поддерживаем оба варианта.
        const stats: any = await ingestJsonlToSqlite({ fromDir, dbPath, since });

        // Если аналитика уже возвращает статистику — распечатаем красиво
        if (stats && typeof stats === "object") {
          const dur = Date.now() - started;
          console.log("");
          console.log(bold("Ingest stats"));
          console.log("  " + cyan("files:    ")
            + `${stats.filesMatched ?? stats.filesScanned ?? 0}`
            + (typeof stats.filesScanned === "number"
                ? dim(` / scanned ${stats.filesScanned}`) : ""));
          console.log("  " + cyan("events:   ")
            + `${stats.eventsValid ?? stats.eventsRead ?? 0}`
            + (typeof stats.eventsRead === "number"
                ? dim(` / read ${stats.eventsRead}`) : ""));
          console.log("  " + cyan("upserted: ")
            + `runs ${stats.runsUpserted ?? 0}, findings ${stats.findingsUpserted ?? 0}`);
          if (typeof stats.duplicatesSkipped === "number") {
            console.log("  " + cyan("skipped:  ")
              + `${stats.duplicatesSkipped} ` + dim("(duplicates)"));
          }
          if (stats.firstTs || stats.lastTs) {
            const firstIso = stats.firstTs ? new Date(stats.firstTs).toISOString() : "—";
            const lastIso  = stats.lastTs  ? new Date(stats.lastTs).toISOString()  : "—";
            console.log("  " + cyan("window:   ") + `${firstIso} ${dim("→")} ${lastIso}`);
          }
          console.log("  " + cyan("duration: ") + `${dur} ms`);
          console.log(green("Done."));
        } else {
          // Старый контракт: просто сообщаем, что всё ок.
          console.log(green("Done."));
        }
      } catch (e: any) {
        console.error(red("Failed to ingest: ") + (e?.message || String(e)));
        if (e?.stack) console.error(dim(e.stack));
        process.exit(1);
      }
    });

  program
    .command("analytics:print")
    .description("Print last run summary from SQLite")
    .option("--db <file>", "sqlite db file", path.join(REPO, ".sentinel/analytics/analytics.db"))
    .action((opts) => {
      const dbPath = path.isAbsolute(opts.db) ? opts.db : path.join(REPO, opts.db);

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

  program
  .command("analytics:stats:runs")
  .description("List last N runs")
  .option("--db <file>", "sqlite db file", path.join(REPO, ".sentinel/analytics/analytics.db"))
  .option("--limit <n>", "how many", "10")
  .action((opts) => {
    const dbPath = path.isAbsolute(opts.db) ? opts.db : path.join(REPO, opts.db);
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

// 2) Тренд по дням
program
  .command("analytics:stats:trend")
  .description("Daily trend for last N days")
  .option("--db <file>", "sqlite db file", path.join(REPO, ".sentinel/analytics/analytics.db"))
  .option("--days <n>", "days window", "14")
  .action((opts) => {
    const dbPath = path.isAbsolute(opts.db) ? opts.db : path.join(REPO, opts.db);
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

// 3) Топ правил
program
  .command("analytics:stats:top-rules")
  .description("Top rules by findings")
  .option("--db <file>", "sqlite db file", path.join(REPO, ".sentinel/analytics/analytics.db"))
  .option("--limit <n>", "how many", "10")
  .action((opts) => {
    const dbPath = path.isAbsolute(opts.db) ? opts.db : path.join(REPO, opts.db);
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

// 4) Суммарная разбивка по severity
program
  .command("analytics:stats:severity")
  .description("Totals by severity (all time)")
  .option("--db <file>", "sqlite db file", path.join(REPO, ".sentinel/analytics/analytics.db"))
  .action((opts) => {
    const dbPath = path.isAbsolute(opts.db) ? opts.db : path.join(REPO, opts.db);
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
}
