import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DATA_DIR, DB_PATH, MIGRATIONS_DIR } from "./config";

let db: Database.Database | undefined;

/** One shared connection per server process. Pending migrations are applied on first use. */
export function getDb(): Database.Database {
  if (!db) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 5000");
    migrate(db);
  }
  return db;
}

/**
 * Applies db/migrations/NNN_name.sql files in order, each once, inside a transaction.
 * Migrations only add tables and columns, so existing records are kept.
 */
export function migrate(conn: Database.Database): string[] {
  conn.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const done = new Set(
    (conn.prepare("SELECT version FROM schema_migrations").all() as { version: string }[]).map((r) => r.version),
  );
  const applied: string[] = [];
  for (const file of fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort()) {
    const version = file.slice(0, 3);
    if (done.has(version)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    conn.transaction(() => {
      conn.exec(sql);
      conn.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(version, new Date().toISOString());
    })();
    applied.push(file);
  }
  return applied;
}
