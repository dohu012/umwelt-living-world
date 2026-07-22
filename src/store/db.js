import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function openDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);

  // Seeds the atomic seq counter above the current max for pre-existing databases
  // (fresh databases start at 0, matching the old MAX(seq)+1-from-empty behavior).
  // OR IGNORE, not a `WHERE NOT EXISTS` guard on the SELECT: an aggregate query without GROUP BY
  // always produces exactly one row even when its WHERE clause filters out every base row, so a
  // `WHERE NOT EXISTS(...)` guard there would still attempt (and fail) the insert every time this
  // runs against an already-migrated database — OR IGNORE is what actually makes this idempotent.
  db.prepare(
    `INSERT OR IGNORE INTO seq_counter (id, value) SELECT 1, COALESCE(MAX(seq), 0) FROM events`,
  ).run();

  return db;
}
