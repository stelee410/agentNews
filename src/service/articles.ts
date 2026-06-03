import { config } from "../config.js";
import { badRequest, conflict, forbidden, notFound } from "../errors.js";
import { parseMarkdown } from "../markdown.js";
import {
  patchArticleInput,
  rawMarkdownInput,
  structuredArticleInput,
} from "../schema.js";
import {
  articleExists,
  deleteArticleFiles,
  readArticle,
  writeArticle,
} from "../storage/articles.js";
import { isWritableType } from "../storage/content-types.js";
import { deindexArticle, indexArticle, indexedArticleMeta } from "../storage/index-db.js";
import type { Article, AuthContext, Lang, Version } from "../types.js";
import { LANGS } from "../types.js";
import { defaultId, isValidId, nowIso } from "../util.js";

/**
 * Service layer: validates input, enforces ownership, and keeps the file
 * source-of-truth and the SQLite index in sync.
 */

function assertBodySize(body: string, lang: string) {
  if (Buffer.byteLength(body, "utf8") > config.maxBodyBytes) {
    throw badRequest(
      "body_too_large",
      `body for lang=${lang} exceeds ${config.maxBodyBytes} bytes`,
      "body"
    );
  }
}

function assertWritableType(type: string) {
  if (!isWritableType(type)) {
    throw badRequest(
      "invalid_type",
      `type '${type}' is not a known/enabled content type`,
      "type"
    );
  }
}

/** Normalize a raw Markdown document into a partial version + frontmatter. */
function versionFromMarkdown(
  raw: string,
  lang: Lang
): { version: Version; type?: string; tags?: string[]; sources?: string[]; related?: string[]; status?: Article["status"]; id?: string } {
  const { data, body } = parseMarkdown(raw);
  if (data.lang && data.lang !== lang) {
    throw badRequest(
      "lang_mismatch",
      `frontmatter lang='${data.lang}' does not match field '${lang}'`,
      "lang"
    );
  }
  const title = String(data.title ?? "").trim();
  const summary = String(data.summary ?? "").trim();
  if (!title) throw badRequest("missing_title", `lang=${lang}: title is required`, "title");
  if (!summary) throw badRequest("missing_summary", `lang=${lang}: summary is required`, "summary");
  assertBodySize(body, lang);
  return {
    version: { lang, title, summary, body },
    type: data.type ? String(data.type) : undefined,
    tags: Array.isArray(data.tags) ? data.tags.map(String) : undefined,
    sources: Array.isArray(data.sources) ? data.sources.map(String) : undefined,
    related: Array.isArray(data.related) ? data.related.map(String) : undefined,
    status: data.status as Article["status"] | undefined,
    id: data.id ? String(data.id) : undefined,
  };
}

type CreateBody = unknown;

/** Detect which input shape was sent and build a draft Article. */
export function buildArticleFromCreate(body: CreateBody, auth: AuthContext): Article {
  const now = nowIso();
  const isRaw =
    body &&
    typeof body === "object" &&
    !("versions" in (body as object)) &&
    (("zh" in (body as object)) || ("en" in (body as object)));

  let article: Article;

  if (isRaw) {
    const parsed = rawMarkdownInput.parse(body);
    const versions: Partial<Record<Lang, Version>> = {};
    let type: string | undefined;
    let tags: string[] = [];
    let sources: string[] = [];
    let related: string[] = [];
    let status: Article["status"] = "published";
    let id: string | undefined;
    let firstTitle = "";

    for (const lang of LANGS) {
      const raw = parsed[lang];
      if (!raw) continue;
      const r = versionFromMarkdown(raw, lang);
      versions[lang] = r.version;
      if (!firstTitle) firstTitle = r.version.title;
      type = type ?? r.type;
      if (r.tags) tags = r.tags;
      if (r.sources) sources = r.sources;
      if (r.related) related = r.related;
      if (r.status) status = r.status;
      id = id ?? r.id;
    }

    if (!type) throw badRequest("missing_type", "frontmatter 'type' is required", "type");
    assertWritableType(type);

    article = {
      id: id && isValidId(id) ? id : defaultId(firstTitle, now),
      type,
      status,
      tags,
      sources,
      related,
      author_agent: auth.agentName,
      updated_by: auth.agentName,
      created_at: now,
      updated_at: now,
      versions,
    };
  } else {
    const parsed = structuredArticleInput.parse(body);
    assertWritableType(parsed.type);
    const versions: Partial<Record<Lang, Version>> = {};
    let firstTitle = "";
    for (const lang of LANGS) {
      const v = parsed.versions[lang];
      if (!v) continue;
      assertBodySize(v.body, lang);
      versions[lang] = { lang, title: v.title, summary: v.summary, body: v.body };
      if (!firstTitle) firstTitle = v.title;
    }
    if (Object.keys(versions).length === 0) {
      throw badRequest("no_versions", "at least one language version is required", "versions");
    }

    const id =
      parsed.id && isValidId(parsed.id) ? parsed.id : defaultId(firstTitle, now);
    article = {
      id,
      type: parsed.type,
      status: parsed.status ?? "published",
      tags: parsed.tags ?? [],
      sources: parsed.sources ?? [],
      related: parsed.related ?? [],
      author_agent: auth.agentName,
      updated_by: auth.agentName,
      created_at: now,
      updated_at: now,
      versions,
    };
  }

  return article;
}

export function createArticle(body: CreateBody, auth: AuthContext): Article {
  const article = buildArticleFromCreate(body, auth);
  if (articleExists(article.id)) {
    throw conflict("id_conflict", `article '${article.id}' already exists`);
  }
  writeArticle(article);
  indexArticle(article);
  return article;
}

/** Ownership / role check for mutating an existing article. */
function assertCanMutate(id: string, auth: AuthContext): string {
  const meta = indexedArticleMeta(id);
  if (!meta) throw notFound(`article '${id}' not found`);
  if (auth.role !== "admin" && meta.author_agent !== auth.agentName) {
    throw forbidden("only the owner or an admin may modify this article");
  }
  return meta.author_agent;
}

/** PUT: full replacement of an existing article (keeps id, owner, created_at). */
export function replaceArticle(id: string, body: CreateBody, auth: AuthContext): Article {
  const owner = assertCanMutate(id, auth);
  const existing = readArticle(id);
  if (!existing) throw notFound(`article '${id}' not found`);

  const draft = buildArticleFromCreate(body, auth);
  const merged: Article = {
    ...draft,
    id, // id is immutable on replace
    author_agent: owner, // creator is preserved
    updated_by: auth.agentName, // stamp who made this update
    created_at: existing.created_at,
    updated_at: nowIso(),
  };
  writeArticle(merged);
  indexArticle(merged);
  return merged;
}

/** PATCH: partial update of an existing article. */
export function patchArticle(id: string, body: unknown, auth: AuthContext): Article {
  const owner = assertCanMutate(id, auth);
  const existing = readArticle(id);
  if (!existing) throw notFound(`article '${id}' not found`);

  const patch = patchArticleInput.parse(body);
  const next: Article = { ...existing, author_agent: owner };

  if (patch.type && patch.type !== existing.type) {
    assertWritableType(patch.type);
    next.type = patch.type;
  }
  if (patch.tags) next.tags = patch.tags;
  if (patch.sources) next.sources = patch.sources;
  if (patch.related) next.related = patch.related;
  if (patch.status) next.status = patch.status;

  if (patch.versions) {
    for (const lang of LANGS) {
      const pv = patch.versions[lang];
      if (!pv) continue;
      const cur = existing.versions[lang];
      const title = pv.title ?? cur?.title;
      const summary = pv.summary ?? cur?.summary;
      const bodyMd = pv.body ?? cur?.body;
      if (!title || !summary || bodyMd === undefined) {
        throw badRequest(
          "incomplete_version",
          `lang=${lang}: title, summary and body are required to add a new version`,
          "versions"
        );
      }
      assertBodySize(bodyMd, lang);
      next.versions[lang] = { lang, title, summary, body: bodyMd };
    }
  }

  next.updated_by = auth.agentName; // stamp who made this update
  next.updated_at = nowIso();
  writeArticle(next);
  indexArticle(next);
  return next;
}

/** DELETE: soft-delete by default (status=archived); hard-delete with ?hard=1. */
export function deleteArticle(id: string, auth: AuthContext, hard = false): void {
  assertCanMutate(id, auth);
  if (hard) {
    deleteArticleFiles(id);
    deindexArticle(id);
    return;
  }
  const existing = readArticle(id);
  if (!existing) throw notFound(`article '${id}' not found`);
  existing.status = "archived";
  existing.updated_by = auth.agentName; // stamp who archived it
  existing.updated_at = nowIso();
  writeArticle(existing);
  indexArticle(existing);
}
