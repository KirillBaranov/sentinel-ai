/* eslint-disable no-console */
const fs = require('node:fs');
const path = require('node:path');
const github = require('@actions/github');

// Удобные константы
const FEEDBACK_DIR  = path.join('.sentinel', 'analytics');
const FEEDBACK_FILE = path.join(FEEDBACK_DIR, 'feedback.jsonl');

// Забираем event payload (GitHub автоматически кладёт путь в GITHUB_EVENT_PATH)
const event = require(process.env.GITHUB_EVENT_PATH);

// Валидация: это точно комментарий в PR и он начинается с /sentinel feedback
const body = (event?.comment?.body || '').trim();
if (!event?.issue?.pull_request || !body.toLowerCase().startsWith('/sentinel feedback')) {
  console.log('Skip: not a PR comment with /sentinel feedback');
  process.exit(0);
}

// Парсинг "командной части"
const rest = body.replace(/^\/sentinel\s+feedback/i, '').trim();

// Простая разметка параметров:
// поддерживаем:
//   rule=RULE_ID | rule: RULE_ID
//   profile=NAME | profile: NAME
//   severity=critical|major|minor|info
//   vote=up|down|neutral  ИЛИ  +1 / -1 как шорткаты
//
// Всё, что не распознали — уходит в message.
let ruleId = undefined;
let profile = undefined;
let severity = undefined;
let vote = 'neutral';

// токенизируем по пробелам, но значения после ":" или "=" слипшиеся считаем одним токеном
const tokens = rest.split(/\s+/);
const leftovers = [];

for (const t of tokens) {
  const m = /^(rule|profile|severity|vote)\s*[:=]\s*(.+)$/i.exec(t);
  if (m) {
    const k = m[1].toLowerCase();
    const v = m[2].trim();
    if (k === 'rule') ruleId = v;
    else if (k === 'profile') profile = v;
    else if (k === 'severity') severity = v.toLowerCase();
    else if (k === 'vote') vote = (v.toLowerCase() === 'up' || v === '+1')
      ? 'up' : (v.toLowerCase() === 'down' || v === '-1') ? 'down' : 'neutral';
    continue;
  }
  // шорткаты голоса
  if (t === '+1') { vote = 'up'; continue; }
  if (t === '-1') { vote = 'down'; continue; }
  leftovers.push(t);
}

const message = leftovers.join(' ').trim();

// Метаданные от GitHub
const repo = github.context.repo.repo;
const owner = github.context.repo.owner;
const prNumber = event.issue?.number;
const commenter = {
  login: event.comment?.user?.login,
  id: event.comment?.user?.id,
};
const ts = Date.now();

// Доп. метаданные, если нужны
const sha = github.context.sha;

// Собираем запись
const record = {
  v: 1,
  type: 'feedback',
  ts,
  owner,
  repo,
  pr: prNumber,
  sha,
  commenter,
  rule_id: ruleId || null,
  profile: profile || null,
  severity: severity || null,
  vote,
  message,
  // можно расширить: run_id, provider, env — когда будем прокидывать
};

// Создаём директорию, пишем JSONL
fs.mkdirSync(FEEDBACK_DIR, { recursive: true });
fs.appendFileSync(FEEDBACK_FILE, JSON.stringify(record) + '\n', 'utf8');

console.log('Feedback appended:');
console.log(JSON.stringify(record, null, 2));
