import crypto from "node:crypto";

export const sha1 = (s: string) => crypto.createHash("sha1").update(s).digest("hex");
export const salted = (s: string, salt = process.env.SENTINEL_SALT || "sentinel") =>
  sha1(`${salt}:${s}`);

export const makeFindingId = (runId: string, ruleId: string, fileHash: string, locator: string) =>
  sha1(`${runId}|${ruleId}|${fileHash}|${locator}`);
