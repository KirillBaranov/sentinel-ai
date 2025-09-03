// packages/cli/src/index.ts
import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { bold, dim } from "colorette";

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
      // остальные поля из файла rc / env
    });

    const diff = opts.diff as string;
    if (!diff) {
      fail("Missing --diff <path>");
      console.log(dim("Example: sentinel review --diff ../../fixtures/changes.diff"));
      process.exit(2);
    }

    try {
      const diffPath = path.isAbsolute(diff) ? diff : path.join(REPO_ROOT, diff);

      // директория профиля для артефактов ревью
      const reviewDirAbs = path.join(rc.out.reviewsDirAbs, rc.profile);
      fs.mkdirSync(reviewDirAbs, { recursive: true });

      const outJson = path.join(reviewDirAbs, rc.out.jsonName);
      const outMd = path.join(reviewDirAbs, rc.out.mdName);

      // приоритеты аналитики:
      // enabled: CLI (--analytics) > rc.analytics.enabled > ENV
      const analyticsEnabled =
        typeof opts.analytics === "boolean"
          ? opts.analytics
          : rc.analytics.enabled ||
            process.env.SENTINEL_ANALYTICS === "1" ||
            process.env.SENTINEL_ANALYTICS === "true";

      // out: CLI (--analytics-out) > rc.analytics.outDir (в rc уже абсолютный)
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
        rc, // пробрасываем целиком (рантайм аналитики читает, если нужно)
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
  .description('Render review.json → human-friendly Markdown (with optional template & severity map)')
  .requiredOption('--in <path>', 'input review.json')
  .requiredOption('--out <path>', 'output review.md')
  .option('--template <path>', 'custom template file (abs or repo-root relative)')
  .option('--severity-map <path>', 'JSON remap of severity labels')
  .action((opts) => {
    try {
      const inPath  = path.isAbsolute(opts.in)  ? opts.in  : path.join(REPO_ROOT, opts.in)
      const outPath = path.isAbsolute(opts.out) ? opts.out : path.join(REPO_ROOT, opts.out)

      const raw = JSON.parse(fs.readFileSync(inPath, 'utf8')) as ReviewJson
      const findings = raw.ai_review?.findings ?? []

      const rc = loadConfig()
      const ropts: RenderOptions = {}

      // ── template: CLI > rc
      if (opts.template) {
        const tpl = path.isAbsolute(opts.template)
          ? opts.template
          : path.join(REPO_ROOT, opts.template)
        if (fs.existsSync(tpl)) ropts.template = fs.readFileSync(tpl, 'utf8')
      } else if (rc.render.template && fs.existsSync(rc.render.template)) {
        ropts.template = fs.readFileSync(rc.render.template, 'utf8')
      }

      // ── severityMap: CLI > rc  (оба случая нормализуем)
      const sevOptPath = (opts as any)['severityMap'] || opts['severity-map']
      if (sevOptPath) {
        const sp = path.isAbsolute(sevOptPath) ? sevOptPath : path.join(REPO_ROOT, sevOptPath)
        if (fs.existsSync(sp)) {
          const rawMap = JSON.parse(fs.readFileSync(sp, 'utf8'))
          ropts.severityMap = normalizeSeverityMap(rawMap)
        }
      } else if (rc.render.severityMap) {
        ropts.severityMap = normalizeSeverityMap(rc.render.severityMap)
      }

      const md = renderMarkdown(findings, ropts)
      fs.mkdirSync(path.dirname(outPath), { recursive: true })
      fs.writeFileSync(outPath, md, 'utf8')

      printRenderSummaryMarkdown({
        repoRoot: REPO_ROOT,
        inFile: inPath,
        outFile: outPath,
        findingsCount: findings.length,
      })
    } catch (e: any) {
      fail(String(e?.stack || e))
      process.exit(1)
    }
  })

// ────────────────────────────────────────────────────────────────────────────────
/** render-html — по умолчанию кладём в <out.reviewsDirAbs>/<profile>/review.html */
// ────────────────────────────────────────────────────────────────────────────────
program
  .command("render-html")
  .description("Render review.json → HTML report")
  .requiredOption("--in <path>", "input review.json")
  .option("--out <path>", "output review.html")
  .action(async (opts) => {
    try {
      const rc = loadConfig();
      const defaultOut = path.join(rc.out.reviewsDirAbs, rc.profile, "review.html");

      const inPath = path.isAbsolute(opts.in) ? opts.in : path.join(REPO_ROOT, opts.in);
      const outPath = opts.out
        ? (path.isAbsolute(opts.out) ? opts.out : path.join(REPO_ROOT, opts.out))
        : defaultOut;

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
