import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

/**
 * SQLite is a *pure, rebuildable query index* (SPEC §5). The Markdown files
 * under content/ are the source of truth; this DB can be dropped and rebuilt
 * from them at any time via scripts/reindex.ts.
 *
 * The one exception is the api_keys / types tables, which are operational
 * state. For the MVP these live in the same DB; reindex preserves them.
 */

let db: Database.Database | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS articles (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'published',
  author_agent TEXT NOT NULL DEFAULT '',
  tags         TEXT NOT NULL DEFAULT '[]',   -- JSON array
  sources      TEXT NOT NULL DEFAULT '[]',   -- JSON array
  related      TEXT NOT NULL DEFAULT '[]',   -- JSON array
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS article_versions (
  article_id TEXT NOT NULL,
  lang       TEXT NOT NULL,
  title      TEXT NOT NULL,
  summary    TEXT NOT NULL,
  PRIMARY KEY (article_id, lang),
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_articles_type_updated
  ON articles(type, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_updated
  ON articles(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_status
  ON articles(status);

CREATE TABLE IF NOT EXISTS types (
  key      TEXT PRIMARY KEY,
  label_zh TEXT NOT NULL,
  label_en TEXT NOT NULL,
  enabled  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS api_keys (
  id          TEXT PRIMARY KEY,
  key_hash    TEXT NOT NULL UNIQUE,
  key_prefix  TEXT NOT NULL,
  role        TEXT NOT NULL,
  agent_name  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  revoked_at  TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT NOT NULL,
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL,
  target     TEXT,
  detail     TEXT
);
`;

const DEFAULT_TYPES = [
  { key: "news", label_zh: "新闻", label_en: "News" },
  { key: "hotspot", label_zh: "热点", label_en: "Hotspot" },
  { key: "blog", label_zh: "博客", label_en: "Blog" },
  { key: "deepread", label_zh: "深度阅读", label_en: "Deep Read" },
];

export function getDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  seedDefaultTypes(db);
  return db;
}

function seedDefaultTypes(d: Database.Database) {
  const count = (d.prepare("SELECT count(*) AS n FROM types").get() as { n: number }).n;
  if (count > 0) return;
  const insert = d.prepare(
    "INSERT INTO types (key, label_zh, label_en, enabled) VALUES (?, ?, ?, 1)"
  );
  const tx = d.transaction(() => {
    for (const t of DEFAULT_TYPES) insert.run(t.key, t.label_zh, t.label_en);
  });
  tx();
}

/** Drop only the rebuildable article index tables (keeps keys/types). */
export function clearArticleIndex(d: Database.Database) {
  d.exec("DELETE FROM article_versions; DELETE FROM articles;");
}

export function audit(
  d: Database.Database,
  actor: string,
  action: string,
  target?: string,
  detail?: string
) {
  d.prepare(
    "INSERT INTO audit_log (ts, actor, action, target, detail) VALUES (?, ?, ?, ?, ?)"
  ).run(new Date().toISOString(), actor, action, target ?? null, detail ?? null);
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
