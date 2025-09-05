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
const REVIEW_MD   = process.env.REVIEW_MD; // optional: human MD preview
const PROFILE     = process.env.PROFILE || 'default';
const FAIL_ON     = (process.env.FAIL_ON || 'major').toLowerCase(); // none|major|critical
const RUN_AT_UTC  = process.env.RUN_AT_UTC || new Date().toISOString();

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
  if (f?.severity && Object.prototype.hasOwnProperty.call(counts, f.severity)) counts[f.severity]++;
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
const sha = github.context.payload?.pull_request?.head?.sha || github.context.sha;
const prNumber = github.context.payload?.pull_request?.number;

(async () => {
  const title = `Sentinel Review — ${PROFILE}: ${total} findings (max=${max})`;
  const summary = [
    `**Profile**: \`${PROFILE}\``,
    `**Run at (UTC)**: ${RUN_AT_UTC}`,
    `**Findings**: ${total} (crit ${counts.critical}, major ${counts.major}, minor ${counts.minor}, info ${counts.info})`,
    `**Max severity**: \`${max}\``,
    `**Fail-on**: \`${FAIL_ON}\``,
    ``,
    `Artifacts: see workflow artifacts (prefix: \`sentinel-artifacts-${PROFILE}\`)`,
  ].filter(Boolean).join('\n');

  try {
    await core.summary
      .addHeading(`Sentinel Review — ${PROFILE}`)
      .addTable([
        [{ data: 'Metric', header: true }, { data: 'Value', header: true }],
        ['Run at (UTC)', RUN_AT_UTC],
        ['Total findings', String(total)],
        ['Critical', String(counts.critical)],
        ['Major', String(counts.major)],
        ['Minor', String(counts.minor)],
        ['Info', String(counts.info)],
        ['Max severity', max],
        ['Fail-on', FAIL_ON],
      ])
      .write();
  } catch (_) {}

  await octo.rest.checks.create({
    owner, repo,
    name: `Sentinel Review — ${PROFILE}`,
    head_sha: sha,
    status: 'completed',
    conclusion: toConclusion(FAIL_ON),
    output: { title, summary },
  });

  if (prNumber) {
    const marker = `<!-- sentinel-sticky-comment:${PROFILE} -->`;
    const body = [
      marker,
      `### 🔎 Sentinel Review — \`${PROFILE}\``,
      `**Run at (UTC)**: ${RUN_AT_UTC}`,
      `**Findings**: ${total} (crit ${counts.critical}, major ${counts.major}, minor ${counts.minor}, info ${counts.info})`,
      `**Max severity**: \`${max}\``,
      `**Fail-on**: \`${FAIL_ON}\``,
      ``,
      `**Artifacts**:`,
      `- Review JSON/MD/HTML: in workflow artifacts \`sentinel-artifacts-${PROFILE}\``,
      `- Analytics exports: same artifact bundle`,
      mdPreview ? `\n<details><summary>Preview (human MD)</summary>\n\n${mdPreview}\n\n</details>\n` : ''
    ].join('\n');

    const comments = await octo.rest.issues.listComments({
      owner, repo, issue_number: prNumber, per_page: 100
    });
    const prev = comments.data.find(c => c.body && c.body.includes(marker));

    if (prev) {
      await octo.rest.issues.updateComment({ owner, repo, comment_id: prev.id, body });
    } else {
      await octo.rest.issues.createComment({ owner, repo, issue_number: prNumber, body });
    }
  }

  console.log(`Published check + sticky comment for profile "${PROFILE}".`);
})().catch(err => {
  core.setFailed(err?.message || String(err));
  process.exit(1);
});
