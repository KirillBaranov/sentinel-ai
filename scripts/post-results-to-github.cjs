/* eslint-disable no-console */
const fs = require('node:fs');
const core = require('@actions/core');
const github = require('@actions/github');

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (!token) {
  core.setFailed('Missing GITHUB_TOKEN (or GH_TOKEN)');
  process.exit(1);
}

const REVIEW_JSON = process.env.REVIEW_JSON || '.sentinel/reviews/review.json';
const REVIEW_MD   = process.env.REVIEW_MD; // optional human-md preview
const PROFILE     = process.env.PROFILE || process.env.SENTINEL_PROFILE || 'default';
const FAIL_ON     = (process.env.FAIL_ON || 'major').toLowerCase(); // none|major|critical
const RUN_AT_UTC  = process.env.RUN_AT_UTC || ''; // optional timestamp from workflow

if (!fs.existsSync(REVIEW_JSON)) {
  core.warning(`review.json not found: ${REVIEW_JSON} (profile=${PROFILE}). Skipping posting.`);
  process.exit(0);
}

let review;
try {
  review = JSON.parse(fs.readFileSync(REVIEW_JSON, 'utf8'));
} catch (e) {
  core.setFailed(`Failed to parse ${REVIEW_JSON}: ${e?.message || e}`);
  process.exit(1);
}

const findings = review?.ai_review?.findings || [];
const counts = { critical: 0, major: 0, minor: 0, info: 0 };
for (const f of findings) {
  if (f?.severity && Object.prototype.hasOwnProperty.call(counts, f.severity)) {
    counts[f.severity]++;
  }
}
const total = findings.length;
const max =
  counts.critical ? 'critical' :
  counts.major    ? 'major'    :
  counts.minor    ? 'minor'    :
  total ? 'info' : 'none';

function toConclusion(threshold) {
  if (threshold === 'none') return 'success';
  if (threshold === 'critical') return counts.critical > 0 ? 'failure' : 'success';
  // default: 'major'
  return (counts.critical > 0 || counts.major > 0) ? 'failure' : 'success';
}

let mdPreview = '';
if (REVIEW_MD && fs.existsSync(REVIEW_MD)) {
  try {
    const md = fs.readFileSync(REVIEW_MD, 'utf8');
    mdPreview = md.split('\n').slice(0, 30).join('\n');
  } catch (_) {}
}

const octo = github.getOctokit(token);
const { owner, repo } = github.context.repo;
const shaFromCtx =
  github.context.payload?.pull_request?.head?.sha ||
  github.context.sha;

async function detectPrNumber() {
  if (github.context.payload?.pull_request?.number) {
    return github.context.payload.pull_request.number;
  }
  if (github.context.issue?.number) {
    return github.context.issue.number;
  }
  try {
    const resp = await octo.rest.repos.listPullRequestsAssociatedWithCommit({
      owner, repo, commit_sha: shaFromCtx,
    });
    const pr = resp?.data?.find(Boolean);
    if (pr?.number) return pr.number;
  } catch (e) {
    core.info(`listPullRequestsAssociatedWithCommit failed: ${e?.message || e}`);
  }
  return null;
}

(async () => {
  const prNumber = await detectPrNumber();
  core.info(`[post-results] repo=${owner}/${repo}`);
  core.info(`[post-results] sha=${shaFromCtx}`);
  core.info(`[post-results] prNumber=${prNumber ?? 'null (not found)'}`);
  core.info(`[post-results] profile=${PROFILE} fail_on=${FAIL_ON}`);
  core.info(`[post-results] review_json=${REVIEW_JSON}`);
  if (REVIEW_MD) core.info(`[post-results] review_md=${REVIEW_MD} (exists=${fs.existsSync(REVIEW_MD)})`);
  if (RUN_AT_UTC) core.info(`[post-results] run_at=${RUN_AT_UTC}`);

  const title = `Sentinel Review — ${PROFILE}: ${total} findings (max=${max})`;
  const lines = [
    `**Profile**: \`${PROFILE}\``,
    `**Findings**: ${total} (crit ${counts.critical}, major ${counts.major}, minor ${counts.minor}, info ${counts.info})`,
    `**Max severity**: \`${max}\``,
    `**Fail-on**: \`${FAIL_ON}\``,
  ];
  if (RUN_AT_UTC) lines.push(`**Run at**: ${new Date(RUN_AT_UTC).toISOString()}`);
  lines.push('', `Artifacts: see workflow artifacts (prefix: \`sentinel-artifacts-${PROFILE}\`)`);

  try {
    await octo.rest.checks.create({
      owner, repo,
      name: `Sentinel Review — ${PROFILE}`,
      head_sha: shaFromCtx,
      status: 'completed',
      conclusion: toConclusion(FAIL_ON),
      output: { title, summary: lines.join('\n') },
    });
    core.info('[post-results] GitHub Check created.');
  } catch (e) {
    core.warning(`[post-results] Failed to create check: ${e?.message || e}`);
  }

  if (!prNumber) {
    core.warning('[post-results] PR number is not found → skipping comment.');
    return;
  }

  const marker = `<!-- sentinel-sticky-comment:${PROFILE} -->`;
  const body = [
    marker,
    `### 🔎 Sentinel Review — \`${PROFILE}\``,
    `**Findings**: ${total} (crit ${counts.critical}, major ${counts.major}, minor ${counts.minor}, info ${counts.info})`,
    `**Max severity**: \`${max}\``,
    `**Fail-on**: \`${FAIL_ON}\``,
    RUN_AT_UTC ? `**Run at (UTC)**: ${new Date(RUN_AT_UTC).toISOString()}` : '',
    ``,
    `**Artifacts**:`,
    `- Review JSON/MD/HTML: in workflow artifacts \`sentinel-artifacts-${PROFILE}\``,
    `- Analytics exports: same artifact bundle`,
    mdPreview ? `\n<details><summary>Preview (human MD)</summary>\n\n${mdPreview}\n\n</details>\n` : '',
  ].filter(Boolean).join('\n');

  try {
    const comments = await octo.rest.issues.listComments({
      owner, repo, issue_number: prNumber, per_page: 100
    });
    const prev = comments.data.find(c => c.body && c.body.includes(marker));

    if (prev) {
      await octo.rest.issues.updateComment({ owner, repo, comment_id: prev.id, body });
      core.info('[post-results] Sticky comment updated.');
    } else {
      await octo.rest.issues.createComment({ owner, repo, issue_number: prNumber, body });
      core.info('[post-results] Sticky comment created.');
    }
  } catch (e) {
    core.setFailed(`[post-results] Failed to upsert sticky comment: ${e?.message || e}`);
    process.exit(1);
  }
})().catch(err => {
  core.setFailed(err?.message || String(err));
  process.exit(1);
});
