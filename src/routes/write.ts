import { Hono } from "hono";
import { ZodError } from "zod";
import { badRequest } from "../errors.js";
import { audit, getDb } from "../db.js";
import { getAuth, requireAuth } from "../middleware/auth.js";
import { writeRateLimit } from "../middleware/ratelimit.js";
import {
  createArticle,
  deleteArticle,
  patchArticle,
  replaceArticle,
} from "../service/articles.js";
import type { Article } from "../types.js";
import { LANGS } from "../types.js";

/**
 * Write API (requires a valid editor/admin key). Mounted under /api/v1.
 */
export const writeRoutes = new Hono();

/**
 * Auth + write rate-limit applied per-route (not via a blanket use("*")) so
 * this sub-app's middleware never leaks onto the open read routes that share
 * the /api/v1 mount prefix.
 */
const guard = [requireAuth, writeRateLimit] as const;

/** Build the canonical JSON response for a written article (SPEC §6.2). */
function articleResponse(a: Article) {
  return {
    id: a.id,
    type: a.type,
    status: a.status,
    tags: a.tags,
    sources: a.sources,
    related: a.related,
    author_agent: a.author_agent,
    created_at: a.created_at,
    updated_at: a.updated_at,
    langs: LANGS.filter((l) => a.versions[l]),
    read: {
      md: `/api/v1/articles/${a.id}`,
      json: `/api/v1/articles/${a.id}?format=json`,
      zh: a.versions.zh ? `/api/v1/articles/${a.id}/zh.md` : null,
      en: a.versions.en ? `/api/v1/articles/${a.id}/en.md` : null,
    },
  };
}

async function readBody(c: import("hono").Context): Promise<unknown> {
  const ct = c.req.header("content-type") ?? "";
  if (!ct.includes("application/json")) {
    throw badRequest("unsupported_media_type", "expected Content-Type: application/json");
  }
  try {
    return await c.req.json();
  } catch {
    throw badRequest("invalid_json", "request body is not valid JSON");
  }
}

/** Translate a ZodError into the SPEC error envelope. */
function rethrowZod(err: unknown): never {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    throw badRequest(
      "invalid_frontmatter",
      first?.message ?? "validation failed",
      first?.path.join(".") || undefined
    );
  }
  throw err;
}

// POST /api/v1/articles
writeRoutes.post("/articles", ...guard, async (c) => {
  const auth = getAuth(c);
  const body = await readBody(c);
  let article: Article;
  try {
    article = createArticle(body, auth);
  } catch (e) {
    rethrowZod(e);
  }
  audit(getDb(), auth.agentName, "create", article.id, article.type);
  return c.json(articleResponse(article), 201);
});

// PUT /api/v1/articles/:id — full replacement
writeRoutes.put("/articles/:id", ...guard, async (c) => {
  const auth = getAuth(c);
  const id = c.req.param("id") as string;
  const body = await readBody(c);
  let article: Article;
  try {
    article = replaceArticle(id, body, auth);
  } catch (e) {
    rethrowZod(e);
  }
  audit(getDb(), auth.agentName, "replace", id);
  return c.json(articleResponse(article));
});

// PATCH /api/v1/articles/:id — partial update
writeRoutes.patch("/articles/:id", ...guard, async (c) => {
  const auth = getAuth(c);
  const id = c.req.param("id") as string;
  const body = await readBody(c);
  let article: Article;
  try {
    article = patchArticle(id, body, auth);
  } catch (e) {
    rethrowZod(e);
  }
  audit(getDb(), auth.agentName, "patch", id);
  return c.json(articleResponse(article));
});

// DELETE /api/v1/articles/:id — soft delete (archive); ?hard=1 to purge
writeRoutes.delete("/articles/:id", ...guard, (c) => {
  const auth = getAuth(c);
  const id = c.req.param("id") as string;
  const hard = c.req.query("hard") === "1";
  deleteArticle(id, auth, hard);
  audit(getDb(), auth.agentName, hard ? "delete_hard" : "archive", id);
  return c.json({ id, status: hard ? "deleted" : "archived" });
});
