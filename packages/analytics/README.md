# 📊 Sentinel Analytics

> Analytics module for Sentinel AI Review.  
> Tracks findings, runs, and feedback to provide transparency, trust, and measurable impact.

---

## 🎯 Goals

- **Transparency** — show what rules are triggered and why
- **Trust** — separate real critical issues from noise  
- **Efficiency** — measure whether AI review reduces QA/reviewer effort and post-merge bugs
- **Governance** — dashboards & alerts tailored to Developers, QA, and Managers
- **Advocacy** — provide metrics that prove the product's value

---

## 🧩 Core Entities

### Finding
- `rule_id`
- `severity` (`critical` | `major` | `minor` | `info`)
- `file` / `line` (hashed in analytics for privacy)
- `status` (`reported` → `fixed` / `dismissed` / `escalated`)

### Run
- `run_id`, `pr_id`, `commit_sha`
- `duration` (ms)
- `cost` (tokens, $)
- `rules_triggered[]`

### Feedback
- `accept` / `dismiss` / `mute_rule` / `escalate`
- *(future: `edit`, `auto_fix_applied`)*

---

## 👥 Use Cases by Role

### 👨‍💻 Developer
- See number of findings per MR, split by severity
- Track time-to-fix for critical issues
- Identify noisy rules (frequent dismiss)

### 🧪 QA
- Prioritize high-risk MRs (impact score ≥ threshold)
- Escalations automatically flagged to QA channels
- **Metric:** reduction of escaped critical bugs

### 👨‍💼 Team Lead / Manager
- Track trends: avg critical findings per MR, dismiss rates
- Manage rules: see which rules add value vs noise
- **Metric:** reduce noise (<20% dismiss rate), improve coverage

### 🏗️ Architect / CTO
- Track AI costs: tokens/day, $/MR
- **SLA:** 95% of reviews finish <90s
- **Metric:** cost per MR decreases while coverage grows

---

## 📈 Key Metrics (KPI)

### Technical
- **Time to Review** (avg duration)
- **Cost per MR** (tokens, $)
- **Coverage** (% of files/rules analyzed)
- **Stability** (error rate <1%)

### Findings Quality
- **Acceptance Rate** = `accepted / total`
- **Dismiss Rate** = `dismissed / total`
- **Escalation Rate** = `escalated / total`
- **Rule Precision Proxy** = % rules with `accept_rate >50%`

### Process Impact
- **Critical findings per MR** (trend)
- **Avg time to fix critical findings**
- **Bug leakage** (QA-found bugs missed by AI)
- **Developer satisfaction** (survey score 1–5)

---

## 📖 Example Scenarios

### Noisy Rule
- Rule generates 100 findings/month
- 70% dismissed as noise
- → Auto-flagged for disablement/tuning

### Escalation to QA
- MR = 500 LOC changed
- 3 critical findings, `impact_score = 0.85`
- → Auto-alert sent to QA Slack channel

### Management Report
- **April:** avg 2.5 critical findings/MR
- **July:** avg 1.1 critical findings/MR
- → Shows measurable code quality improvement

---

## 🚀 Next Steps

1. **Implement tracking pipeline:** capture Run + Findings + Feedback
2. **Store anonymized file paths** (hashed)
3. **Define impact_score formula**
4. **Expose metrics in dashboards** (Grafana/Metabase)
5. **Add alerts for thresholds** (e.g. ≥3 critical findings)

---

## 📂 Module Roadmap

- **analytics-core** — entity definitions, events, schema
- **analytics-storage** — persistence (DB, API, warehouse)
- **analytics-reporting** — dashboards, CLI reports
- **analytics-alerts** — Slack/email/webhooks
