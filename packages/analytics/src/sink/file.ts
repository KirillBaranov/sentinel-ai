import fs from 'node:fs'
import path from 'node:path'
import type { AnalyticsEvent } from '../types'

export class FileSink {
  private dir: string
  private currentFile: string

  constructor(dir: string, fileName?: string) {
    this.dir = dir
    fs.mkdirSync(this.dir, { recursive: true })
    this.currentFile = path.join(this.dir, fileName ?? `${new Date().toISOString().slice(0,10)}.jsonl`)
  }

  setRunFile(runId: string) {
    this.currentFile = path.join(this.dir, `${runId}.jsonl`)
  }

  async write(ev: AnalyticsEvent): Promise<void> {
    await fs.promises.appendFile(this.currentFile, JSON.stringify(ev) + '\n', 'utf8')
  }
}
