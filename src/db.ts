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
  updated_by   TEXT NOT NULL DEFAULT '',
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
  enabled  INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 1000   -- nav/column ordering, ascending
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
  { key: "news", label_zh: "新闻", label_en: "News", position: 10 },
  { key: "hotspot", label_zh: "热点", label_en: "Hotspot", position: 20 },
  { key: "blog", label_zh: "博客", label_en: "Blog", position: 30 },
  { key: "deepread", label_zh: "深度阅读", label_en: "Deep Read", position: 40 },
  { key: "podcast", label_zh: "播客", label_en: "Podcast", position: 70 },
];

/** Add columns introduced after the initial schema, for existing databases. */
function migrate(d: Database.Database) {
  const typeCols = d.prepare("PRAGMA table_info(types)").all() as Array<{ name: string }>;
  if (!typeCols.some((c) => c.name === "position")) {
    d.exec("ALTER TABLE types ADD COLUMN position INTEGER NOT NULL DEFAULT 1000");
  }
  const artCols = d.prepare("PRAGMA table_info(articles)").all() as Array<{ name: string }>;
  if (!artCols.some((c) => c.name === "updated_by")) {
    d.exec("ALTER TABLE articles ADD COLUMN updated_by TEXT NOT NULL DEFAULT ''");
  }
}

export function getDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  migrate(db);
  seedDefaultTypes(db);
  return db;
}

/**
 * Ensure the built-in content types exist. Idempotent: INSERT OR IGNORE adds
 * any default type missing from the DB (so existing deployments pick up newly
 * shipped types like `podcast` on next boot) without disturbing types or
 * positions an admin has already customized.
 */
function seedDefaultTypes(d: Database.Database) {
  const insert = d.prepare(
    "INSERT OR IGNORE INTO types (key, label_zh, label_en, enabled, position) VALUES (?, ?, ?, 1, ?)"
  );
  const tx = d.transaction(() => {
    for (const t of DEFAULT_TYPES) insert.run(t.key, t.label_zh, t.label_en, t.position);
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
