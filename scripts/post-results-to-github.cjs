/* eslint-disable no-console */
const fs = require('node:fs');
const path = require('node:path');
const core = require('@actions/core');
const github = require('@actions/github');

const repoToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (!repoToken) { console.error('Missing GITHUB_TOKEN'); process.exit(1); }

const reviewJson = JSON.parse(fs.readFileSync('.sentinel/reviews/review.json','utf8'));
const findings = reviewJson?.ai_review?.findings || [];

const octo = github.getOctokit(repoToken);
const { owner, repo } = github.context.repo;
const sha = github.context.payload.pull_request?.head?.sha || github.context.sha;
const prNumber = github.context.payload.pull_request?.number;

const counts = { critical:0, major:0, minor:0, info:0 };
for (const f of findings) counts[f.severity] = (counts[f.severity]||0)+1;
const total = findings.length;
const max =
  (counts.critical ? 'critical' :
   counts.major    ? 'major' :
   counts.minor    ? 'minor' : (total ? 'info' : 'none'));

(async () => {
  // 1) GitHub Check (summary)
  const title = `Sentinel Review: ${total} findings (max=${max})`;
  const summary = [
    `**Findings**: ${total} (crit ${counts.critical}, major ${counts.major}, minor ${counts.minor}, info ${counts.info})`,
    `**Artifacts**: see workflow artifacts ("sentinel-artifacts")`,
  ].join('\n');
  const conclusion =
    counts.critical ? 'failure' :
    counts.major ? 'failure' :
    'success'; // подправьте под ваш failOn

  await octo.rest.checks.create({
    owner, repo,
    name: 'Sentinel Review',
    head_sha: sha,
    status: 'completed',
    conclusion,
    output: {
      title,
      summary,
    }
  });

  // 2) Sticky comment (upsert)
  if (prNumber) {
    const header = '<!-- sentinel-sticky-comment -->';
    const body = [
      header,
      `### 🔎 Sentinel Review`,
      `**Result**: ${total} findings (crit ${counts.critical}, major ${counts.major}, minor ${counts.minor}, info ${counts.info})`,
      `**Max severity**: \`${max}\``,
      ``,
      `**Artifacts**:`,
      `- Review HTML: _in workflow artifacts_`,
      `- Analytics exports: _in workflow artifacts_`,
    ].join('\n');

    const comments = await octo.rest.issues.listComments({ owner, repo, issue_number: prNumber, per_page: 100 });
    const prev = comments.data.find(c => c.body?.includes('sentinel-sticky-comment'));
    if (prev) {
      await octo.rest.issues.updateComment({ owner, repo, comment_id: prev.id, body });
    } else {
      await octo.rest.issues.createComment({ owner, repo, issue_number: prNumber, body });
    }
  }

  console.log('Published check + sticky comment.');
})();
