import fs from "node:fs";
import path from "node:path";
import type { EnvelopeV1 } from "./schemas";

export class JsonlWriter {
  constructor(private dir = process.env.SENTINEL_ANALYTICS_DIR || ".sentinel/analytics") {}

  private targetFile(): string {
    const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return path.join(this.dir, `events.${day}.jsonl`);
  }

  write(e: EnvelopeV1) {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.appendFileSync(this.targetFile(), JSON.stringify(e) + "\n", "utf8");
  }
}
