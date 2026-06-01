import matter from "gray-matter";
import MarkdownIt from "markdown-it";
import type { Article, Lang, Version } from "./types.js";

const md = new MarkdownIt({
  html: false, // never trust raw HTML in agent-submitted content
  linkify: true,
  typographer: false,
});

/** Render Markdown body to sanitized HTML for the human Web UI. */
export function renderHtml(body: string): string {
  return md.render(body ?? "");
}

/** YAML frontmatter key order for stable, readable output. */
const FRONTMATTER_KEYS = [
  "id",
  "type",
  "lang",
  "title",
  "summary",
  "tags",
  "sources",
  "author_agent",
  "created_at",
  "updated_at",
  "related",
  "status",
] as const;

/**
 * Serialize a single language version to a full Markdown document
 * (frontmatter + body), matching SPEC §4.1.
 */
export function toMarkdown(article: Article, lang: Lang): string {
  const v = article.versions[lang];
  if (!v) throw new Error(`version ${lang} missing`);
  const data: Record<string, unknown> = {
    id: article.id,
    type: article.type,
    lang,
    title: v.title,
    summary: v.summary,
    tags: article.tags,
    sources: article.sources,
    author_agent: article.author_agent,
    created_at: article.created_at,
    updated_at: article.updated_at,
    related: article.related,
    status: article.status,
  };
  // gray-matter.stringify emits keys in insertion order; build ordered object.
  const ordered: Record<string, unknown> = {};
  for (const k of FRONTMATTER_KEYS) {
    if (data[k] !== undefined) ordered[k] = data[k];
  }
  return matter.stringify("\n" + (v.body ?? "").replace(/^\n+/, ""), ordered);
}

export interface ParsedDoc {
  data: Record<string, unknown>;
  body: string;
}

/** Parse a Markdown document into frontmatter data + body. */
export function parseMarkdown(input: string): ParsedDoc {
  const parsed = matter(input);
  return { data: parsed.data as Record<string, unknown>, body: parsed.content.replace(/^\n+/, "") };
}

/** Build a JSON projection of one version (for ?format=json). */
export function versionJson(article: Article, lang: Lang) {
  const v: Version | undefined = article.versions[lang];
  if (!v) return null;
  return {
    id: article.id,
    type: article.type,
    lang,
    title: v.title,
    summary: v.summary,
    tags: article.tags,
    sources: article.sources,
    author_agent: article.author_agent,
    created_at: article.created_at,
    updated_at: article.updated_at,
    related: article.related,
    status: article.status,
    body: v.body,
  };
}
