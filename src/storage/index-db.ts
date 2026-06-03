import type Database from "better-sqlite3";
import { getDb } from "../db.js";
import type { Article, FeedRow, Lang } from "../types.js";
import { LANGS } from "../types.js";
import { decodeCursor, encodeCursor } from "../util.js";

/** Upsert an article's queryable fields into the SQLite index. */
export function indexArticle(article: Article, d: Database.Database = getDb()) {
  const upsertArticle = d.prepare(`
    INSERT INTO articles (id, type, status, author_agent, updated_by, tags, sources, related, created_at, updated_at)
    VALUES (@id, @type, @status, @author_agent, @updated_by, @tags, @sources, @related, @created_at, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      type=excluded.type, status=excluded.status, author_agent=excluded.author_agent,
      updated_by=excluded.updated_by,
      tags=excluded.tags, sources=excluded.sources, related=excluded.related,
      created_at=excluded.created_at, updated_at=excluded.updated_at
  `);
  const delVersions = d.prepare("DELETE FROM article_versions WHERE article_id = ?");
  const insVersion = d.prepare(`
    INSERT INTO article_versions (article_id, lang, title, summary)
    VALUES (?, ?, ?, ?)
  `);

  const tx = d.transaction(() => {
    upsertArticle.run({
      id: article.id,
      type: article.type,
      status: article.status,
      author_agent: article.author_agent,
      updated_by: article.updated_by,
      tags: JSON.stringify(article.tags),
      sources: JSON.stringify(article.sources),
      related: JSON.stringify(article.related),
      created_at: article.created_at,
      updated_at: article.updated_at,
    });
    delVersions.run(article.id);
    for (const lang of LANGS) {
      const v = article.versions[lang];
      if (v) insVersion.run(article.id, lang, v.title, v.summary);
    }
  });
  tx();
}

export function deindexArticle(id: string, d: Database.Database = getDb()) {
  d.prepare("DELETE FROM articles WHERE id = ?").run(id);
}

/** Look up an article's owner + status without touching disk. */
export function indexedArticleMeta(
  id: string,
  d: Database.Database = getDb()
): { author_agent: string; status: string; type: string } | null {
  const row = d
    .prepare("SELECT author_agent, status, type FROM articles WHERE id = ?")
    .get(id) as { author_agent: string; status: string; type: string } | undefined;
  return row ?? null;
}

export interface FeedQuery {
  types?: string[];
  lang: Lang;
  tags?: string[];
  since?: string;
  limit: number;
  cursor?: string;
  includeArchived?: boolean;
}

export interface FeedResult {
  rows: FeedRow[];
  nextCursor: string | null;
}

interface CursorState {
  updated_at: string;
  id: string;
}

/**
 * Query the feed. Orders by updated_at DESC, id DESC for a stable keyset
 * cursor. The chosen lang's title/summary is returned; rows are restricted
 * to articles that have that language version available.
 */
export function queryFeed(q: FeedQuery, d: Database.Database = getDb()): FeedResult {
  const where: string[] = [];
  const params: unknown[] = [];

  // Only surface articles that have the requested language version.
  where.push(
    "EXISTS (SELECT 1 FROM article_versions v WHERE v.article_id = a.id AND v.lang = ?)"
  );
  params.push(q.lang);

  if (!q.includeArchived) {
    where.push("a.status = 'published'");
  } else {
    where.push("a.status != 'archived'");
  }

  if (q.types && q.types.length > 0) {
    where.push(`a.type IN (${q.types.map(() => "?").join(",")})`);
    params.push(...q.types);
  }

  if (q.since) {
    where.push("a.updated_at > ?");
    params.push(q.since);
  }

  // Tag filter: AND semantics over a JSON array stored as text.
  if (q.tags && q.tags.length > 0) {
    for (const tag of q.tags) {
      where.push(
        "EXISTS (SELECT 1 FROM json_each(a.tags) je WHERE je.value = ?)"
      );
      params.push(tag);
    }
  }

  // Keyset pagination cursor.
  const cur = q.cursor ? decodeCursor<CursorState>(q.cursor) : null;
  if (cur) {
    where.push("(a.updated_at < ? OR (a.updated_at = ? AND a.id < ?))");
    params.push(cur.updated_at, cur.updated_at, cur.id);
  }

  const sql = `
    SELECT a.id, a.type, a.tags, a.updated_at, a.updated_by,
           v.title AS title, v.summary AS summary
    FROM articles a
    JOIN article_versions v ON v.article_id = a.id AND v.lang = ?
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY a.updated_at DESC, a.id DESC
    LIMIT ?
  `;
  const all: unknown[] = [q.lang, ...params, q.limit + 1];
  const raw = d.prepare(sql).all(...all) as Array<{
    id: string;
    type: string;
    tags: string;
    updated_at: string;
    updated_by: string;
    title: string;
    summary: string;
  }>;

  const hasMore = raw.length > q.limit;
  const page = raw.slice(0, q.limit);

  const rows: FeedRow[] = page.map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    summary: r.summary,
    tags: safeTags(r.tags),
    updated_at: r.updated_at,
    updated_by: r.updated_by,
    available_langs: availableLangs(r.id, d),
  }));

  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last ? encodeCursor({ updated_at: last.updated_at, id: last.id }) : null;

  return { rows, nextCursor };
}

function safeTags(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function availableLangs(id: string, d: Database.Database): Lang[] {
  const rows = d
    .prepare("SELECT lang FROM article_versions WHERE article_id = ?")
    .all(id) as Array<{ lang: string }>;
  return rows.map((r) => r.lang as Lang);
}

/** Recent published article ids, newest first (for llms-full snapshot). */
export function recentIds(limit: number, d: Database.Database = getDb()): string[] {
  const rows = d
    .prepare(
      "SELECT id FROM articles WHERE status = 'published' ORDER BY updated_at DESC, id DESC LIMIT ?"
    )
    .all(limit) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

/** Distinct tags with counts, for the human tag index. */
export function distinctTags(d: Database.Database = getDb()): Array<{ tag: string; count: number }> {
  const rows = d
    .prepare(
      `SELECT je.value AS tag, count(*) AS count
       FROM articles a, json_each(a.tags) je
       WHERE a.status = 'published'
       GROUP BY je.value ORDER BY count DESC, tag ASC`
    )
    .all() as Array<{ tag: string; count: number }>;
  return rows;
}
