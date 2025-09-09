import crypto from 'node:crypto'
import { ReviewFinding, Severity } from '../types'

const sha1 = (s: string) => crypto.createHash('sha1').update(s).digest('hex')

export function buildFinding(input: Omit<ReviewFinding, 'fingerprint'>): ReviewFinding {
  const key = `${input.rule}\n${input.file}\n${input.locator}\n${input.finding?.[0] ?? ''}`
  console.log('check and catch me')
  return { ...input, fingerprint: sha1(key) }
}

/** Утилита: форматировать "[Lxx] msg" и корректно процитировать триггерный текст */
export function evidenceLine(lineNo: number, text: string, msg: string): string {
  const quoted = text.length > 180 ? text.slice(0, 177) + '…' : text
  return `[L${lineNo}] ${msg}: "${quoted}"`
}
