import type { FeedResult } from "../storage/index-db.js";
import type { FeedRow, Lang } from "../types.js";

/** Render a feed result as the token-minimal Markdown list (SPEC §6.1). */
export function feedToMarkdown(
  result: FeedResult,
  opts: { types?: string[]; lang: Lang; basePath: string; query: string }
): string {
  const head =
    `# agentNews feed — type=${opts.types?.join(",") || "all"} lang=${opts.lang}\n`;
  if (result.rows.length === 0) {
    return head + "\n(no articles)\n";
  }
  const lines = result.rows.map((r: FeedRow) => {
    const tags = r.tags.length ? r.tags.join(", ") : "—";
    return (
      `- [${r.id}] ${r.title}\n` +
      `  - summary: ${r.summary}\n` +
      `  - updated: ${r.updated_at} · tags: ${tags}\n` +
      `  - get: /api/v1/articles/${r.id}?lang=${opts.lang}`
    );
  });
  let out = head + "\n" + lines.join("\n") + "\n";
  if (result.nextCursor) {
    const sep = opts.query ? "&" : "";
    out += `\nnext: ${opts.basePath}?${opts.query}${sep}cursor=${result.nextCursor}\n`;
  }
  return out;
}

/** JSON projection of a feed result. */
export function feedToJson(result: FeedResult, lang: Lang) {
  return {
    lang,
    items: result.rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      summary: r.summary,
      tags: r.tags,
      updated_at: r.updated_at,
      available_langs: r.available_langs,
      get: `/api/v1/articles/${r.id}?lang=${lang}`,
    })),
    next_cursor: result.nextCursor,
  };
}
