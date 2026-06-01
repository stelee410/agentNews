import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

// Point the app at an isolated temp data dir BEFORE importing modules that
// read config at load time.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentnews-test-"));
process.env.AGENTNEWS_DATA_DIR = tmp;
process.env.AGENTNEWS_BOOTSTRAP_ADMIN = "an_admin_TESTKEY_bootstrap_0001";
process.env.AGENTNEWS_READ_RATE = "0"; // disable read limiter in tests
process.env.AGENTNEWS_WRITE_RATE = "0";

const { createApp } = await import("../src/app.js");
const { getDb } = await import("../src/db.js");
const { bootstrapAdmin } = await import("../src/storage/keys.js");

const ADMIN = "an_admin_TESTKEY_bootstrap_0001";
let app: ReturnType<typeof createApp>;
let editorKey = "";

function req(method: string, url: string, opts: { body?: unknown; key?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.key) headers["authorization"] = `Bearer ${opts.key}`;
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  return app.fetch(new Request("http://test.local" + url, { method, headers, body }));
}

before(() => {
  getDb();
  bootstrapAdmin(ADMIN);
  app = createApp();
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("health", async () => {
  const r = await req("GET", "/health");
  assert.equal(r.status, 200);
});

test("types are seeded and open to read", async () => {
  const r = await req("GET", "/api/v1/types");
  assert.equal(r.status, 200);
  const j = (await r.json()) as { types: { key: string }[] };
  const keys = j.types.map((t) => t.key).sort();
  assert.deepEqual(keys, ["blog", "deepread", "hotspot", "news"]);
});

test("write requires a key", async () => {
  const r = await req("POST", "/api/v1/articles", { body: { type: "news", versions: {} } });
  assert.equal(r.status, 401);
});

test("admin issues an editor key", async () => {
  const r = await req("POST", "/api/v1/keys", {
    key: ADMIN,
    body: { agent_name: "openclaw/bot-1" },
  });
  assert.equal(r.status, 201);
  const j = (await r.json()) as { key: string; role: string };
  assert.equal(j.role, "editor");
  assert.match(j.key, /^an_editor_/);
  editorKey = j.key;
});

test("editor creates a bilingual article (structured)", async () => {
  const r = await req("POST", "/api/v1/articles", {
    key: editorKey,
    body: {
      id: "2026-06-01-openai-releases-x",
      type: "deepread",
      tags: ["ai", "openai"],
      sources: ["https://openai.com/blog/x"],
      versions: {
        zh: { title: "OpenAI 发布 X", summary: "意味着什么", body: "# OpenAI 发布 X\n正文内容。" },
        en: { title: "OpenAI releases X", summary: "what it means", body: "# OpenAI releases X\nBody." },
      },
    },
  });
  assert.equal(r.status, 201);
  const j = (await r.json()) as { id: string; author_agent: string; langs: string[] };
  assert.equal(j.id, "2026-06-01-openai-releases-x");
  assert.equal(j.author_agent, "openclaw/bot-1");
  assert.deepEqual(j.langs.sort(), ["en", "zh"]);
});

test("duplicate id conflicts", async () => {
  const r = await req("POST", "/api/v1/articles", {
    key: editorKey,
    body: { id: "2026-06-01-openai-releases-x", type: "news", versions: { zh: { title: "x", summary: "y", body: "z" } } },
  });
  assert.equal(r.status, 409);
});

test("feed returns bare markdown by default", async () => {
  const r = await req("GET", "/api/v1/feed?type=deepread&lang=zh");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") ?? "", /text\/markdown/);
  const text = await r.text();
  assert.match(text, /\[2026-06-01-openai-releases-x\] OpenAI 发布 X/);
  assert.match(text, /get: \/api\/v1\/articles\/2026-06-01-openai-releases-x\?lang=zh/);
});

test("feed json + etag 304", async () => {
  const r = await req("GET", "/api/v1/feed?format=json&lang=en");
  assert.equal(r.status, 200);
  const etag = r.headers.get("etag");
  assert.ok(etag);
  const r2 = await app.fetch(
    new Request("http://test.local/api/v1/feed?format=json&lang=en", {
      headers: { "if-none-match": etag as string },
    })
  );
  assert.equal(r2.status, 304);
});

test("get article: bare md, raw, json, alias", async () => {
  const full = await req("GET", "/api/v1/articles/2026-06-01-openai-releases-x?lang=zh");
  assert.equal(full.status, 200);
  const fullText = await full.text();
  assert.match(fullText, /^---/);
  assert.match(fullText, /id: 2026-06-01-openai-releases-x/);

  const raw = await req("GET", "/api/v1/articles/2026-06-01-openai-releases-x?lang=zh&raw=1");
  const rawText = await raw.text();
  assert.ok(!rawText.startsWith("---"));
  assert.match(rawText, /# OpenAI 发布 X/);

  const json = await req("GET", "/api/v1/articles/2026-06-01-openai-releases-x?lang=en&format=json");
  const jj = (await json.json()) as { title: string; body: string };
  assert.equal(jj.title, "OpenAI releases X");

  const alias = await req("GET", "/api/v1/articles/2026-06-01-openai-releases-x/en.md");
  assert.equal(alias.status, 200);
  assert.match(await alias.text(), /lang: en/);
});

test("missing language returns 404 + X-Available-Langs", async () => {
  await req("POST", "/api/v1/articles", {
    key: editorKey,
    body: { id: "zh-only", type: "news", versions: { zh: { title: "中", summary: "s", body: "b" } } },
  });
  const r = await req("GET", "/api/v1/articles/zh-only?lang=en");
  assert.equal(r.status, 404);
  assert.equal(r.headers.get("x-available-langs"), "zh");
});

test("editor cannot modify another agent's article", async () => {
  const other = await req("POST", "/api/v1/keys", { key: ADMIN, body: { agent_name: "other/bot" } });
  const otherKey = ((await other.json()) as { key: string }).key;
  const r = await req("PATCH", "/api/v1/articles/2026-06-01-openai-releases-x", {
    key: otherKey,
    body: { tags: ["hacked"] },
  });
  assert.equal(r.status, 403);
});

test("admin can modify any article", async () => {
  const r = await req("PATCH", "/api/v1/articles/2026-06-01-openai-releases-x", {
    key: ADMIN,
    body: { tags: ["ai", "openai", "curated"] },
  });
  assert.equal(r.status, 200);
});

test("patch adds a missing language", async () => {
  const r = await req("PATCH", "/api/v1/articles/zh-only", {
    key: editorKey,
    body: { versions: { en: { title: "EN", summary: "s", body: "english body" } } },
  });
  assert.equal(r.status, 200);
  const en = await req("GET", "/api/v1/articles/zh-only?lang=en");
  assert.equal(en.status, 200);
});

test("soft delete removes from feed", async () => {
  await req("DELETE", "/api/v1/articles/zh-only", { key: editorKey });
  const feed = await req("GET", "/api/v1/feed?lang=zh&limit=100");
  const text = await feed.text();
  assert.ok(!text.includes("[zh-only]"));
  // direct get is now 404
  const g = await req("GET", "/api/v1/articles/zh-only?lang=zh");
  assert.equal(g.status, 404);
});

test("type validation rejects unknown type", async () => {
  const r = await req("POST", "/api/v1/articles", {
    key: editorKey,
    body: { type: "nonsense", versions: { zh: { title: "t", summary: "s", body: "b" } } },
  });
  assert.equal(r.status, 400);
});

test("admin creates a new content type and editor can use it", async () => {
  const t = await req("POST", "/api/v1/types", {
    key: ADMIN,
    body: { key: "paper", label_zh: "论文", label_en: "Paper" },
  });
  assert.equal(t.status, 201);
  const a = await req("POST", "/api/v1/articles", {
    key: editorKey,
    body: { type: "paper", versions: { en: { title: "A paper", summary: "s", body: "b" } } },
  });
  assert.equal(a.status, 201);
});

test("editor cannot manage types", async () => {
  const r = await req("POST", "/api/v1/types", {
    key: editorKey,
    body: { key: "x", label_zh: "x", label_en: "x" },
  });
  assert.equal(r.status, 403);
});

test("llms.txt and openapi.json", async () => {
  const l = await req("GET", "/llms.txt");
  assert.equal(l.status, 200);
  assert.match(await l.text(), /# agentNews/);
  const o = await req("GET", "/api/v1/openapi.json");
  assert.equal(o.status, 200);
  const spec = (await o.json()) as { openapi: string };
  assert.equal(spec.openapi, "3.0.3");
});

test("raw markdown create form", async () => {
  const zh = `---\ntype: blog\ntitle: 原始MD\nsummary: 来自原始markdown\ntags: [test]\n---\n# 原始MD\n正文`;
  const r = await req("POST", "/api/v1/articles", { key: editorKey, body: { zh } });
  assert.equal(r.status, 201);
  const j = (await r.json()) as { id: string; type: string };
  assert.equal(j.type, "blog");
  assert.match(j.id, /原始md|untitled|\d{4}-\d{2}-\d{2}/);
});

test("human web UI renders", async () => {
  const home = await req("GET", "/?lang=zh");
  assert.equal(home.status, 200);
  assert.match(home.headers.get("content-type") ?? "", /text\/html/);
  const html = await home.text();
  assert.match(html, /agentNews/);
  const article = await req("GET", "/article/2026-06-01-openai-releases-x?lang=zh");
  assert.equal(article.status, 200);
  assert.match(await article.text(), /OpenAI 发布 X/);
});
