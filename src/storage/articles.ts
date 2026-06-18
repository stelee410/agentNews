import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import type { Article, Lang } from "../types.js";
import { LANGS } from "../types.js";
import { parseMarkdown, toMarkdown } from "../markdown.js";

/**
 * File storage: content/<type>/<id>/{zh,en}.md + meta.json.
 * Markdown files are the single source of truth (SPEC §5).
 */

function articleDir(type: string, id: string): string {
  return path.join(config.contentDir, type, id);
}

/** Find the directory for an id by scanning type folders (type may change). */
export function findArticleDir(id: string): string | null {
  if (!fs.existsSync(config.contentDir)) return null;
  for (const type of fs.readdirSync(config.contentDir)) {
    const dir = path.join(config.contentDir, type, id);
    if (fs.existsSync(path.join(dir, "meta.json"))) return dir;
  }
  return null;
}

export function articleExists(id: string): boolean {
  return findArticleDir(id) !== null;
}

/** Persist an article: write meta.json + one .md per present language. */
export function writeArticle(article: Article): void {
  const dir = articleDir(article.type, article.id);
  // If the type changed, move (not delete) the old directory so uploaded
  // assets survive; the md/meta files are rewritten below anyway.
  const existing = findArticleDir(article.id);
  if (existing && path.resolve(existing) !== path.resolve(dir)) {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    fs.renameSync(existing, dir);
  }
  fs.mkdirSync(dir, { recursive: true });

  const meta = {
    id: article.id,
    type: article.type,
    status: article.status,
    tags: article.tags,
    sources: article.sources,
    related: article.related,
    author_agent: article.author_agent,
    updated_by: article.updated_by,
    created_at: article.created_at,
    updated_at: article.updated_at,
    langs: LANGS.filter((l) => article.versions[l]),
  };
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");

  for (const lang of LANGS) {
    const file = path.join(dir, `${lang}.md`);
    if (article.versions[lang]) {
      fs.writeFileSync(file, toMarkdown(article, lang));
    } else if (fs.existsSync(file)) {
      fs.rmSync(file);
    }
  }
}

/** Load a full article (all present languages) from disk. */
export function readArticle(id: string): Article | null {
  const dir = findArticleDir(id);
  if (!dir) return null;
  const metaRaw = fs.readFileSync(path.join(dir, "meta.json"), "utf8");
  const meta = JSON.parse(metaRaw) as {
    id: string;
    type: string;
    status: Article["status"];
    tags: string[];
    sources: string[];
    related: string[];
    author_agent: string;
    updated_by?: string;
    created_at: string;
    updated_at: string;
  };

  const article: Article = {
    id: meta.id,
    type: meta.type,
    status: meta.status,
    tags: meta.tags ?? [],
    sources: meta.sources ?? [],
    related: meta.related ?? [],
    author_agent: meta.author_agent ?? "",
    // Backfill for articles written before updated_by existed.
    updated_by: meta.updated_by ?? meta.author_agent ?? "",
    created_at: meta.created_at,
    updated_at: meta.updated_at,
    versions: {},
  };

  for (const lang of LANGS) {
    const file = path.join(dir, `${lang}.md`);
    if (!fs.existsSync(file)) continue;
    const { data, body } = parseMarkdown(fs.readFileSync(file, "utf8"));
    article.versions[lang] = {
      lang,
      title: String(data.title ?? ""),
      summary: String(data.summary ?? ""),
      body,
    };
  }
  return article;
}

/** Hard-delete article files from disk. */
export function deleteArticleFiles(id: string): void {
  const dir = findArticleDir(id);
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
}

/** Iterate every article on disk (used for reindex / llms-full). */
export function* iterArticles(): Generator<Article> {
  if (!fs.existsSync(config.contentDir)) return;
  for (const type of fs.readdirSync(config.contentDir)) {
    const typeDir = path.join(config.contentDir, type);
    if (!fs.statSync(typeDir).isDirectory()) continue;
    for (const id of fs.readdirSync(typeDir)) {
      const dir = path.join(typeDir, id);
      if (!fs.existsSync(path.join(dir, "meta.json"))) continue;
      const a = readArticle(id);
      if (a) yield a;
    }
  }
}

export function langAvailable(article: Article, lang: Lang): boolean {
  return Boolean(article.versions[lang]);
}
