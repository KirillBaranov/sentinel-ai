import Database from "better-sqlite3";
import { ensureSchema } from "../ingest/ensureSchema";

export function migrate(opts: { dbPath: string }) {
  const db = new Database(opts.dbPath);
  try { ensureSchema(db); } finally { db.close(); }
}
