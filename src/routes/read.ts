import { Hono } from "hono";
import { config } from "../config.js";
import { notFound } from "../errors.js";
import { toMarkdown, versionJson } from "../markdown.js";
import { feedToJson, feedToMarkdown } from "../render/feed-md.js";
import { readArticle } from "../storage/articles.js";
import { queryFeed, recentIds } from "../storage/index-db.js";
import type { Lang } from "../types.js";
import { LANGS } from "../types.js";
import { etagOf, parseList } from "../util.js";

/**
 * Open read API (no key). Defaults to bare Markdown to minimize downstream
 * agent token cost (SPEC §7). Adds ETag + Cache-Control for cheap revalidation.
 */
export const readRoutes = new Hono();

function cacheHeaders(c: import("hono").Context, etag: string) {
  c.header("ETag", etag);
  c.header(
    "Cache-Control",
    `public, max-age=${config.cacheMaxAge}, stale-while-revalidate=${config.cacheSwr}`
  );
}

/** Returns true (and sends 304) if the client's If-None-Match matches. */
function notModified(c: import("hono").Context, etag: string): boolean {
  const inm = c.req.header("if-none-match");
  if (inm && inm.split(",").map((s) => s.trim()).includes(etag)) {
    c.header("ETag", etag);
    return true;
  }
  return false;
}

function parseLang(raw: string | undefined, def: Lang = "zh"): Lang {
  return raw === "en" || raw === "zh" ? raw : def;
}

// GET /api/v1/feed
readRoutes.get("/feed", (c) => {
  const types = parseList(c.req.query("type"));
  const lang = parseLang(c.req.query("lang"));
  const tags = parseList(c.req.query("tag"));
  const since = c.req.query("since") || undefined;
  const cursor = c.req.query("cursor") || undefined;
  const format = c.req.query("format") === "json" ? "json" : "md";
  let limit = Number.parseInt(c.req.query("limit") ?? "30", 10);
  if (!Number.isFinite(limit)) limit = 30;
  limit = Math.min(100, Math.max(1, limit));

  const result = queryFeed({
    types: types.length ? types : undefined,
    lang,
    tags: tags.length ? tags : undefined,
    since,
    limit,
    cursor,
  });

  if (format === "json") {
    const json = feedToJson(result, lang);
    const etag = etagOf(JSON.stringify(json));
    if (notModified(c, etag)) return c.body(null, 304);
    cacheHeaders(c, etag);
    return c.json(json);
  }

  // Rebuild query string (minus cursor) for the `next` link.
  const params = new URLSearchParams();
  if (types.length) params.set("type", types.join(","));
  params.set("lang", lang);
  if (tags.length) params.set("tag", tags.join(","));
  if (since) params.set("since", since);
  params.set("limit", String(limit));

  const body = feedToMarkdown(result, {
    types: types.length ? types : undefined,
    lang,
    basePath: "/api/v1/feed",
    query: params.toString(),
  });
  const etag = etagOf(body);
  if (notModified(c, etag)) return c.body(null, 304);
  cacheHeaders(c, etag);
  c.header("Content-Type", "text/markdown; charset=utf-8");
  return c.body(body);
});

/** Resolve an article + language, applying 404 + X-Available-Langs semantics. */
function loadVersion(id: string, lang: Lang) {
  const article = readArticle(id);
  if (!article || article.status === "archived") {
    throw notFound(`article '${id}' not found`);
  }
  if (!article.versions[lang]) {
    const available = LANGS.filter((l) => article.versions[l]);
    const err = notFound(`language '${lang}' not available for '${id}'`);
    return { article, missing: true, available, err } as const;
  }
  return { article, missing: false } as const;
}

// GET /api/v1/articles/:id/:file  (convenience aliases zh.md / en.md)
readRoutes.get("/articles/:id/:file", (c) => {
  const id = c.req.param("id");
  const file = c.req.param("file");
  const m = file.match(/^(zh|en)\.md$/);
  if (!m) throw notFound("expected {id}/zh.md or {id}/en.md");
  const lang = m[1] as Lang;
  const res = loadVersion(id, lang);
  if (res.missing) {
    c.header("X-Available-Langs", res.available.join(","));
    throw res.err;
  }
  const body = toMarkdown(res.article, lang);
  const etag = etagOf(body);
  if (notModified(c, etag)) return c.body(null, 304);
  cacheHeaders(c, etag);
  c.header("Content-Type", "text/markdown; charset=utf-8");
  return c.body(body);
});

// GET /api/v1/articles/:id
readRoutes.get("/articles/:id", (c) => {
  const id = c.req.param("id");
  const lang = parseLang(c.req.query("lang"));
  const raw = c.req.query("raw") === "1";
  const format = c.req.query("format");

  const res = loadVersion(id, lang);
  if (res.missing) {
    c.header("X-Available-Langs", res.available.join(","));
    throw res.err;
  }
  const { article } = res;

  if (format === "json") {
    const json = versionJson(article, lang);
    const etag = etagOf(JSON.stringify(json));
    if (notModified(c, etag)) return c.body(null, 304);
    cacheHeaders(c, etag);
    return c.json(json);
  }

  const full = toMarkdown(article, lang);
  const body = raw ? (article.versions[lang]?.body ?? "") : full;
  const etag = etagOf(body);
  if (notModified(c, etag)) return c.body(null, 304);
  cacheHeaders(c, etag);
  c.header("Content-Type", "text/markdown; charset=utf-8");
  return c.body(body);
});

// GET /api/v1/articles/:id/related not in v1; skip.

/** Helper exported for llms-full assembly. */
export function buildLlmsFull(): string {
  const ids = recentIds(config.llmsFullLimit);
  const parts: string[] = [
    "# agentNews — recent articles (concatenated)\n",
    `> Newest ${ids.length} published articles, zh preferred, full Markdown.\n`,
  ];
  for (const id of ids) {
    const a = readArticle(id);
    if (!a) continue;
    const lang: Lang = a.versions.zh ? "zh" : "en";
    if (!a.versions[lang]) continue;
    parts.push("\n---\n\n" + toMarkdown(a, lang));
  }
  return parts.join("\n");
}
