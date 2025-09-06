import 'dotenv/config';

import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { bold, dim } from "colorette";

import { config as loadEnv } from "dotenv";

import { buildContextCLI } from "./context";
import { runReviewCLI } from "./review";
import { renderHtmlCLI } from "./cmd/render-html";
import { initProfileCLI } from "./cmd/init-profile";
import { loadConfig } from "./config";
import { normalizeSeverityMap } from './config/severity-normalize'

import {
  findRepoRoot,
  fail,
  printRenderSummaryMarkdown,
  printRenderSummaryHtml,
} from "./cli-utils";

import {
  type RenderOptions,
  renderMarkdown,
} from "@sentinel/core";

import { registerAnalyticsCommands } from "./cmd/analytics";

// ────────────────────────────────────────────────────────────────────────────────
// Repo root (.git | pnpm-workspace.yaml | fallback)
// ────────────────────────────────────────────────────────────────────────────────
const REPO_ROOT = findRepoRoot();

process.env.SENTINEL_REPO_ROOT ||= REPO_ROOT;

loadEnv({ path: path.join(REPO_ROOT, ".env") });
loadEnv();

// Узкий локальный тип для чтения review.json (не тянем типы из core сюда)
interface ReviewJson {
  ai_review: {
    version: 1;
    run_id: string;
    findings: Array<{
      rule: string;
      area: string;
      severity: "critical" | "major" | "minor" | "info";
      file: string;
      locator: string;
      finding: string[];
      why: string;
      suggestion: string;
      fingerprint: string;
    }>;
  };
}

// ────────────────────────────────────────────────────────────────────────────────
const program = new Command()
  .name("sentinel")
  .description(`${bold("Sentinel AI CLI")} — code review with profiles, providers & analytics`)
  .version("0.1.0");

program.showHelpAfterError();
program.showSuggestionAfterError();

// ────────────────────────────────────────────────────────────────────────────────
// build-context
// ────────────────────────────────────────────────────────────────────────────────
program
  .command("build-context")
  .description("Build AI review context (handbook + rules + ADR) into out/context/<profile>.md")
  .option("-p, --profile <profile>", "profile name")
  .option("--profiles-dir <dir>", "override profiles root")
  .option("-o, --out <file>", "override output file (abs or repo-root relative)")
  .action(async (opts) => {
    try {
      const rc = loadConfig({
        profile: opts.profile,
        profilesDir: opts.profilesDir,
      });

      // по умолчанию пишем в <out.rootAbs>/<contextDir>/<profile>.md
      const defaultOut = path.join(rc.out.contextDirAbs, `${rc.profile}.md`);
      const outFile = opts.out
        ? (path.isAbsolute(opts.out) ? opts.out : path.join(REPO_ROOT, opts.out))
        : defaultOut;

      await buildContextCLI({
        profile: rc.profile,
        profilesDir: rc.profilesDir,
        out: outFile,
        includeADR: rc.context.includeADR,
        includeBoundaries: rc.context.includeBoundaries,
        maxBytes: rc.context.maxBytes,
        maxApproxTokens: rc.context.maxApproxTokens,
      } as any);
      // buildContextCLI печатает summary сам
    } catch (e: any) {
      if (/not found: .+rules\.json/.test(String(e?.message))) {
        fail(e.message);
        const tmp = loadConfig({ profile: opts.profile, profilesDir: opts.profilesDir });
        const candidates =
          [
            "`profiles/<name>`",
            "`packages/profiles/<name>`",
            tmp.profilesDir && `\`${tmp.profilesDir}/${tmp.profile}\``,
          ]
            .filter(Boolean)
            .join(", ");
        console.log(
          "\n" +
            `Profile "${tmp.profile}" not found. Looked in: ${candidates}.\n` +
            `Try: ${bold("sentinel init-profile --name " + tmp.profile)} or pass ${bold("--profiles-dir")} to override root.`
        );
      } else {
        fail(String(e?.stack || e));
      }
      process.exit(1);
    }
  });

// ────────────────────────────────────────────────────────────────────────────────
// review
// ────────────────────────────────────────────────────────────────────────────────
program
  .command("review")
  .description("Run review (local/mock/openai), write JSON and Markdown transport")
  .requiredOption("-d, --diff <path>", "unified diff file")
  .option("-p, --profile <profile>", "profile name")
  .option("--profiles-dir <dir>", "override profiles root")
  .option("--provider <name>", "provider: local|mock|openai|claude")
  .option("--fail-on <level>", "none|major|critical (exit policy)")
  .option("--max-comments <n>", "cap number of findings")
  .option("--out-json <path>", "override review.json output path (abs or repo-root relative)")
  .option("--out-md <path>",   "override review.md output path (abs or repo-root relative)")
  .option("--analytics", "enable analytics (file JSONL sink)")
  .option("--analytics-out <dir>", "analytics output dir (overrides rc.analytics.outDir)")
  .option("--debug", "verbose debug logs", false)
  .action(async (opts: any) => {
    const parsedMax =
      typeof opts.maxComments === "string" ? Number(opts.maxComments) : opts.maxComments;
    const maxComments = Number.isFinite(parsedMax as number)
      ? (parsedMax as number)
      : undefined;

    const rc = loadConfig({
      profile: opts.profile,
      profilesDir: opts.profilesDir,
      provider: opts.provider,
      failOn: opts.failOn,
      maxComments,
    });

    const diff = opts.diff as string;
    if (!diff) {
      fail("Missing --diff <path>");
      console.log(dim("Example: sentinel review --diff ../../fixtures/changes.diff"));
      process.exit(2);
    }

    try {
      const diffPath = path.isAbsolute(diff) ? diff : path.join(REPO_ROOT, diff);

      // базовая директория артефактов для профиля
      const reviewDirAbs = path.join(rc.out.reviewsDirAbs, rc.profile);
      fs.mkdirSync(reviewDirAbs, { recursive: true });

      // пути вывода: CLI > по умолчанию из rc
      const outJson = opts.outJson
        ? (path.isAbsolute(opts.outJson) ? opts.outJson : path.join(REPO_ROOT, opts.outJson))
        : path.join(reviewDirAbs, rc.out.jsonName);

      const outMd = opts.outMd
        ? (path.isAbsolute(opts.outMd) ? opts.outMd : path.join(REPO_ROOT, opts.outMd))
        : path.join(reviewDirAbs, rc.out.mdName);

      // аналитика: enabled и outDir с учётом CLI
      const analyticsEnabled =
        typeof opts.analytics === "boolean"
          ? opts.analytics
          : rc.analytics.enabled ||
            process.env.SENTINEL_ANALYTICS === "1" ||
            process.env.SENTINEL_ANALYTICS === "true";

      const analyticsOut: string | undefined =
        (typeof opts.analyticsOut === "string" && opts.analyticsOut
          ? (path.isAbsolute(opts.analyticsOut)
              ? opts.analyticsOut
              : path.join(REPO_ROOT, opts.analyticsOut))
          : rc.analytics.outDir) || undefined;

      await runReviewCLI({
        diff: diffPath,
        profile: rc.profile,
        profilesDir: rc.profilesDir,
        provider: rc.provider,
        outMd,
        outJson,
        failOn: rc.failOn as any,
        maxComments,
        analytics: analyticsEnabled,
        analyticsOut,
        debug: !!opts.debug,
        rc,
      });
    } catch (e: any) {
      if (/Profile .* not found/.test(String(e?.message))) {
        fail(e.message);
        const tmp = loadConfig({ profile: opts.profile });
        const candidates =
          [
            "`profiles/<name>`",
            "`packages/profiles/<name>`",
            opts.profilesDir && `\`${opts.profilesDir}/${tmp.profile}\``,
          ]
            .filter(Boolean)
            .join(", ");
        console.log(
          "\n" +
            `Profile "${tmp.profile}" not found. Looked in: ${candidates}.\n` +
            `Try: ${bold("sentinel init-profile --name " + tmp.profile)} or pass ${bold("--profiles-dir")} to override root.`
        );
      } else {
        fail(String(e?.stack || e));
      }
      process.exit(1);
    }
  });

  // ────────────────────────────────────────────────────────────────────────────────
// render-md
// ────────────────────────────────────────────────────────────────────────────────
  program
    .command('render-md')
    .description('Render review.json → human-friendly Markdown (defaults from config; overridable via flags)')
    .option('-p, --profile <profile>', 'profile name (default from rc/env)')
    .option('--in <path>',  'input review.json (abs or repo-root relative)')
    .option('--out <path>', 'output review.md (abs or repo-root relative)')
    .option('--template <path>', 'custom template file (abs or repo-root relative)')
    .option('--severity-map <path>', 'JSON with full SeverityMap {title, icon?, order?}')
    .action((opts) => {
      try {
        // 1) конфиг + профиль
        const rc = loadConfig({ profile: opts.profile });
        const profile = opts.profile || process.env.SENTINEL_PROFILE || rc.profile;

        // 2) пути по умолчанию
        const defaultIn  = path.join(rc.out.reviewsDirAbs, profile, rc.out.jsonName);              // .../reviews/<profile>/review.json
        const defaultOut = path.join(
          rc.out.reviewsDirAbs,
          profile,
          rc.out.mdName.replace(/\.md$/i, '.human.md')                                            // .../reviews/<profile>/review.human.md
        );

        const inPath = opts.in
          ? (path.isAbsolute(opts.in) ? opts.in : path.join(rc.repoRoot, opts.in))
          : defaultIn;

        const outPath = opts.out
          ? (path.isAbsolute(opts.out) ? opts.out : path.join(rc.repoRoot, opts.out))
          : defaultOut;

        if (!fs.existsSync(inPath)) {
          fail(`[render-md] input not found: ${inPath}`);
          process.exit(2);
        }

        // 3) читаем review.json
        const raw = JSON.parse(fs.readFileSync(inPath, 'utf8')) as ReviewJson;
        const findings = raw.ai_review?.findings ?? [];

        // 4) опции рендера: CLI > rc
        const ropts: RenderOptions = {};

        // template
        if (opts.template) {
          const tpl = path.isAbsolute(opts.template) ? opts.template : path.join(rc.repoRoot, opts.template);
          if (fs.existsSync(tpl)) ropts.template = fs.readFileSync(tpl, 'utf8');
        } else if (rc.render.template && fs.existsSync(rc.render.template)) {
          ropts.template = fs.readFileSync(rc.render.template, 'utf8');
        }

        // severity map — нормализуем к полной форме
        const sevPath = (opts as any)['severityMap'] || opts['severity-map'];
        if (sevPath) {
          const sp = path.isAbsolute(sevPath) ? sevPath : path.join(rc.repoRoot, sevPath);
          if (fs.existsSync(sp)) ropts.severityMap = normalizeSeverityMap(JSON.parse(fs.readFileSync(sp, 'utf8')));
        } else if (rc.render.severityMap) {
          ropts.severityMap = normalizeSeverityMap(rc.render.severityMap);
        }

        // 5) рендер и запись
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        const md = renderMarkdown(findings, ropts);
        fs.writeFileSync(outPath, md, 'utf8');

        printRenderSummaryMarkdown({
          repoRoot: rc.repoRoot,
          inFile: inPath,
          outFile: outPath,
          findingsCount: findings.length,
        });
      } catch (e: any) {
        fail(String(e?.stack || e));
        process.exit(1);
      }
    });

// ────────────────────────────────────────────────────────────────────────────────
/** render-html — по умолчанию кладём в <out.reviewsDirAbs>/<profile>/review.html */
// ────────────────────────────────────────────────────────────────────────────────
program
  .command("render-html")
  .description("Render review.json → HTML report")
  .option("--in <path>",  "input review.json (defaults to .sentinel/reviews/<profile>/review.json)")
  .option("--out <path>", "output review.html (defaults next to input or to .sentinel/reviews/<profile>/review.html)")
  .action(async (opts) => {
    try {
      const rc = loadConfig();

      const defaultIn  = path.join(rc.out.reviewsDirAbs, rc.profile, rc.out.jsonName);     // .../review.json
      const defaultOut = path.join(rc.out.reviewsDirAbs, rc.profile, "review.html");

      const inPathRaw = opts.in ?? defaultIn;
      const inPath = path.isAbsolute(inPathRaw) ? inPathRaw : path.join(REPO_ROOT, inPathRaw);

      if (!fs.existsSync(inPath)) {
        fail(`[render-html] input not found: ${inPath}`);
        process.exit(2);
      }

      let outPath: string;
      if (opts.out) {
        outPath = path.isAbsolute(opts.out) ? opts.out : path.join(REPO_ROOT, opts.out);
      } else {
        const derived = inPath.replace(/\.json$/i, "") + ".html";
        outPath = derived || defaultOut;
      }

      await renderHtmlCLI({ inFile: inPath, outFile: outPath });
    } catch (e: any) {
      fail(String(e?.stack || e));
      process.exit(1);
    }
  });

// ────────────────────────────────────────────────────────────────────────────────
// init-profile
// ────────────────────────────────────────────────────────────────────────────────
program
  .command("init-profile")
  .description("Scaffold a new review profile (handbook + rules + boundaries [+ ADR])")
  .requiredOption("--name <name>", "profile name (e.g. frontend)")
  .option("--out-dir <dir>", "profiles root (default: packages/profiles)")
  .option("--force", "overwrite existing files", false)
  .option("--with-adr", "create docs/adr starter file", false)
  .action(async (opts) => {
    try {
      await initProfileCLI({
        name: opts.name,
        outDir: opts.outDir,
        force: !!opts.force,
        withAdr: !!opts.withAdr,
      });
      // initProfileCLI печатает summary и next steps сам
    } catch (e: any) {
      fail(String(e?.stack || e));
      process.exit(1);
    }
  });

// ────────────────────────────────────────────────────────────────────────────────
// analytics (подкоманды подтягиваются из пакета @sentinel/analytics)
// ────────────────────────────────────────────────────────────────────────────────
registerAnalyticsCommands(program);

// help footer
program.addHelpText(
  "afterAll",
  `
${dim("Config sources (priority high→low):")} CLI ${bold(">")} ENV ${bold(">")} .sentinelrc.json ${bold(">")} defaults
Repo root: ${dim(REPO_ROOT)}
`
);

// run
program.parseAsync().catch((e) => {
  fail(String(e?.stack || e));
  process.exit(1);
});
