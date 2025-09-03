import fs from "node:fs";
import path from "node:path";
import { ensureDirForFile } from "../lib/fs";
import type { ResolvedAnalyticsConfig } from "../types";

export type TransportEvent = Record<string, unknown>;

export interface Transport {
  write(e: TransportEvent): void;
  currentFile?(): string | undefined;
  rotateForRun?(runId: string): void;
}

function ymd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function sanitizeRunId(runId: string) {
  // безопасное имя файла
  return runId.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export class FileTransport implements Transport {
  private fileAbs?: string;

  constructor(private cfg: ResolvedAnalyticsConfig) {
    // гарантируем наличие директории назначения
    fs.mkdirSync(this.cfg.outDir, { recursive: true });

    // для byDay заранее вычисляем путь (можно и «лениво» — не принципиально)
    if (this.cfg.mode === "byDay") {
      this.fileAbs = path.join(this.cfg.outDir, `${ymd()}.jsonl`);
      ensureDirForFile(this.fileAbs);
    }
  }

  currentFile() {
    return this.fileAbs;
  }

  rotateForRun(runId: string) {
    // актуально только для byRun
    if (this.cfg.mode !== "byRun") return;
    const safe = sanitizeRunId(runId);
    const next = path.join(this.cfg.outDir, `run-${safe}.jsonl`);
    if (this.fileAbs === next) return;
    this.fileAbs = next;
    ensureDirForFile(this.fileAbs);
  }

  write(e: TransportEvent) {
    // если файл ещё не выбран (например, byDay — «лениво»)
    if (!this.fileAbs) {
      this.fileAbs =
        this.cfg.mode === "byRun"
          ? path.join(this.cfg.outDir, "run-unknown.jsonl")
          : path.join(this.cfg.outDir, `${ymd()}.jsonl`);
      ensureDirForFile(this.fileAbs);
    }

    const line = JSON.stringify(e) + "\n";
    // синхронная запись — без буферов/таймеров → без гонок и пустых файлов
    fs.appendFileSync(this.fileAbs, line, "utf8");
  }
}
