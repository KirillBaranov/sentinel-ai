import fs from "node:fs";
import path from "node:path";
import { ensureDirForFile } from "../lib/fs";
import type { ResolvedAnalyticsConfig } from "../types";

export type TransportEvent = Record<string, unknown>;

export interface Transport {
  write(e: TransportEvent): void;
  currentFile?(): string | undefined;
  rotateForRun?(runId: string): void;
  close?(): void;                             // <-- добавлено
}

function ymd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function sanitizeRunId(runId: string) {
  return runId.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export class FileTransport implements Transport {
  private stream: fs.WriteStream | null = null;
  private fileAbs?: string;

  constructor(private cfg: ResolvedAnalyticsConfig) {
    fs.mkdirSync(this.cfg.outDir, { recursive: true });
    if (this.cfg.mode === "byDay") {
      this.fileAbs = path.join(this.cfg.outDir, `${ymd()}.jsonl`);
      ensureDirForFile(this.fileAbs);
      this.stream = fs.createWriteStream(this.fileAbs, { flags: "a" });
    }
  }

  currentFile() {
    return this.fileAbs;
  }

  rotateForRun(runId: string) {
    if (this.cfg.mode !== "byRun") return;
    const safe = sanitizeRunId(runId);
    const next = path.join(this.cfg.outDir, `run-${safe}.jsonl`);
    if (this.fileAbs === next && this.stream) return;

    if (this.stream) { try { this.stream.end(); } catch {} this.stream = null; }
    this.fileAbs = next;
    ensureDirForFile(this.fileAbs);
    this.stream = fs.createWriteStream(this.fileAbs, { flags: "a" });
  }

  write(e: TransportEvent) {
    if (!this.stream) {
      const fallback = path.join(this.cfg.outDir, `${ymd()}.jsonl`);
      ensureDirForFile(fallback);
      this.fileAbs = fallback;
      this.stream = fs.createWriteStream(fallback, { flags: "a" });
    }
    this.stream.write(JSON.stringify(e) + "\n");
  }

  close() {
    if (this.stream) {
      try { this.stream.end(); } catch {}
      this.stream = null;
    }
  }
}
