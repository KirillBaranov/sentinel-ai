import { z } from "zod";

// Общий конверт v1
export const EnvelopeV1 = z.object({
  v: z.literal(1),
  type: z.string(),
  ts: z.number().int(),
  run_id: z.string(),
  project_id: z.string(),
  commit_sha: z.string().optional(),
  branch: z.string().optional(),
  provider: z.string().optional(),
  profile: z.string().optional(),
  env: z.enum(["ci", "dev", "local"]).optional(),
  payload: z.unknown().optional(),
});
export type EnvelopeV1 = z.infer<typeof EnvelopeV1>;

// Специфики событий
export const RunStarted = EnvelopeV1.extend({
  type: z.literal("run.started"),
  payload: z.object({
    model: z.string().optional(),
    ci_job_id: z.string().optional(),
  }).optional(),
});

export const FindingReported = EnvelopeV1.extend({
  type: z.literal("finding.reported"),
  payload: z.object({
    rule_id: z.string(),
    severity: z.enum(["info", "minor", "major", "critical"]),
    finding_id: z.string(),           // sha1(run_id|rule_id|file_hash|locator)
    file_hash: z.string(),
    locator: z.string(),
    signals: z.object({
      provider_conf: z.number().min(0).max(1).optional(),
      rule_conf: z.number().min(0).max(1).optional(),
      has_test_changes: z.boolean().optional(),
      related_tests_count: z.number().int().optional(),
      coverage_delta_pct: z.number().optional(),
      uncovered_touched_lines: z.number().int().optional(),
      diff_size_approx: z.number().int().optional(),
      file_risk: z.number().min(0).max(1).optional(),
      rule_requires_tests: z.boolean().optional(),
      area_tags: z.array(z.string()).optional(),
    }).optional(),
  }),
});

export const RunFinished = EnvelopeV1.extend({
  type: z.literal("run.finished"),
  payload: z.object({
    duration_ms: z.number().int(),
    findings_total: z.number().int(),
    findings_by_severity: z.object({
      critical: z.number().int(),
      major: z.number().int(),
      minor: z.number().int(),
      info: z.number().int(),
    }),
    impact_avg: z.number().optional(),
    risk_level: z.enum(["low", "medium", "high", "critical"]).optional(),
    tests_changed: z.boolean().optional(),    // пригодится QA/регрессия
  }),
});

export type RunStarted = z.infer<typeof RunStarted>;
export type FindingReported = z.infer<typeof FindingReported>;
export type RunFinished = z.infer<typeof RunFinished>;
