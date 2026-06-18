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
  assert.deepEqual(keys, ["blog", "deepread", "hotspot", "news", "podcast"]);
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
  const j = (await r.json()) as {
    id: string;
    author_agent: string;
    updated_by: string;
    langs: string[];
  };
  assert.equal(j.id, "2026-06-01-openai-releases-x");
  assert.equal(j.author_agent, "openclaw/bot-1");
  assert.equal(j.updated_by, "openclaw/bot-1"); // creator is the first updater
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

test("update stamps updated_by with the editor, keeps original author", async () => {
  const r = await req("GET", "/api/v1/articles/2026-06-01-openai-releases-x?lang=zh&format=json");
  const j = (await r.json()) as { author_agent: string; updated_by: string };
  assert.equal(j.author_agent, "openclaw/bot-1"); // original creator unchanged
  assert.equal(j.updated_by, "bootstrap-admin"); // last modified by the admin patch
  // frontmatter also carries it
  const md = await (await req("GET", "/api/v1/articles/2026-06-01-openai-releases-x?lang=zh")).text();
  assert.match(md, /updated_by: bootstrap-admin/);
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

test("image assets: upload, list, serve, delete", async () => {
  // Minimal valid-enough PNG bytes (magic header + padding).
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const putAsset = (file: string, key?: string, body: Buffer = png, ct = "image/png") =>
    app.fetch(
      new Request(`http://test.local/api/v1/articles/2026-06-01-openai-releases-x/assets/${file}`, {
        method: "PUT",
        headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), "content-type": ct },
        body: new Uint8Array(body),
      })
    );

  // no key → 401; non-owner editor → 403
  assert.equal((await putAsset("cover.png")).status, 401);
  const other = await req("POST", "/api/v1/keys", { key: ADMIN, body: { agent_name: "other/asset-bot" } });
  const otherKey = ((await other.json()) as { key: string }).key;
  assert.equal((await putAsset("cover.png", otherKey)).status, 403);

  // bad extension / bad name → 400
  assert.equal((await putAsset("evil.svg", editorKey)).status, 400);
  assert.equal((await putAsset("..%2Fescape.png", editorKey)).status, 400);

  // owner upload → 201 with canonical URL
  const up = await putAsset("cover.png", editorKey);
  assert.equal(up.status, 201);
  const info = (await up.json()) as { url: string; bytes: number; content_type: string };
  assert.equal(info.content_type, "image/png");
  assert.equal(info.bytes, png.length);
  assert.match(info.url, /\/assets\/cover\.png$/);

  // open list + open serve with correct headers
  const list = await req("GET", "/api/v1/articles/2026-06-01-openai-releases-x/assets");
  assert.equal(list.status, 200);
  const lj = (await list.json()) as { assets: { file: string }[] };
  assert.deepEqual(lj.assets.map((a) => a.file), ["cover.png"]);

  const got = await req("GET", "/api/v1/articles/2026-06-01-openai-releases-x/assets/cover.png");
  assert.equal(got.status, 200);
  assert.equal(got.headers.get("content-type"), "image/png");
  assert.ok(got.headers.get("etag"));
  assert.equal(Buffer.compare(Buffer.from(await got.arrayBuffer()), png), 0);

  // web article page rewrites relative assets/ refs to the asset endpoint
  await req("PATCH", "/api/v1/articles/2026-06-01-openai-releases-x", {
    key: editorKey,
    body: { versions: { zh: { body: "正文内容。\n\n![配图](assets/cover.png)" } } },
  });
  const page = await req("GET", "/article/2026-06-01-openai-releases-x?lang=zh");
  const pageHtml = await page.text();
  assert.match(pageHtml, /<img src="\/api\/v1\/articles\/2026-06-01-openai-releases-x\/assets\/cover\.png"/);

  // delete (owner) → gone for readers
  const del = await req("DELETE", "/api/v1/articles/2026-06-01-openai-releases-x/assets/cover.png", {
    key: editorKey,
  });
  assert.equal(del.status, 200);
  const gone = await req("GET", "/api/v1/articles/2026-06-01-openai-releases-x/assets/cover.png");
  assert.equal(gone.status, 404);
});

test("assets survive a type change", async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  await app.fetch(
    new Request("http://test.local/api/v1/articles/2026-06-01-openai-releases-x/assets/keep.png", {
      method: "PUT",
      headers: { authorization: `Bearer ${editorKey}`, "content-type": "image/png" },
      body: new Uint8Array(png),
    })
  );
  // moving the article to another type must carry assets/ along
  const r = await req("PATCH", "/api/v1/articles/2026-06-01-openai-releases-x", {
    key: ADMIN,
    body: { type: "news" },
  });
  assert.equal(r.status, 200);
  const got = await req("GET", "/api/v1/articles/2026-06-01-openai-releases-x/assets/keep.png");
  assert.equal(got.status, 200);
});

test("podcast: create episode, upload audio, web renders a player", async () => {
  // 1) create a podcast-type article (the episode + show notes)
  const create = await req("POST", "/api/v1/articles", {
    key: editorKey,
    body: {
      id: "2026-06-09-ep-1",
      type: "podcast",
      tags: ["ai", "weekly"],
      versions: { zh: { title: "第 1 期:AI 周报", summary: "本周要闻", body: "# 第 1 期\n\nShow notes 内容。" } },
    },
  });
  assert.equal(create.status, 201);

  // 2) upload the audio episode
  const mp3 = Buffer.from([0x49, 0x44, 0x33, 0x03, 0, 0, 0, 0, 0, 0]); // "ID3" header
  const up = await app.fetch(
    new Request("http://test.local/api/v1/articles/2026-06-09-ep-1/assets/episode-01.mp3", {
      method: "PUT",
      headers: { authorization: `Bearer ${editorKey}`, "content-type": "audio/mpeg" },
      body: new Uint8Array(mp3),
    })
  );
  assert.equal(up.status, 201);
  const info = (await up.json()) as { kind: string; content_type: string };
  assert.equal(info.kind, "audio");
  assert.equal(info.content_type, "audio/mpeg");

  // mismatched Content-Type (image header on an audio name) is rejected
  const bad = await app.fetch(
    new Request("http://test.local/api/v1/articles/2026-06-09-ep-1/assets/x.mp3", {
      method: "PUT",
      headers: { authorization: `Bearer ${editorKey}`, "content-type": "image/png" },
      body: new Uint8Array(mp3),
    })
  );
  assert.equal(bad.status, 400);

  // 3) list marks it as audio; serve returns the audio mime
  const list = (await (await req("GET", "/api/v1/articles/2026-06-09-ep-1/assets")).json()) as {
    assets: { file: string; kind: string }[];
  };
  assert.deepEqual(list.assets, [{ file: "episode-01.mp3", kind: "audio", bytes: mp3.length, content_type: "audio/mpeg", url: "/api/v1/articles/2026-06-09-ep-1/assets/episode-01.mp3" }]);
  const served = await req("GET", "/api/v1/articles/2026-06-09-ep-1/assets/episode-01.mp3");
  assert.equal(served.headers.get("content-type"), "audio/mpeg");

  // 4) web detail page renders an <audio> player
  const page = await (await req("GET", "/article/2026-06-09-ep-1?lang=zh")).text();
  assert.match(page, /<audio controls[^>]*src="\/api\/v1\/articles\/2026-06-09-ep-1\/assets\/episode-01\.mp3"/);
});

test("human web UI renders", async () => {
  const home = await req("GET", "/?lang=zh");
  assert.equal(home.status, 200);
  assert.match(home.headers.get("content-type") ?? "", /text\/html/);
  const html = await home.text();
  assert.match(html, /agentNews/);
  const article = await req("GET", "/article/2026-06-01-openai-releases-x?lang=zh");
  assert.equal(article.status, 200);
  const articleHtml = await article.text();
  assert.match(articleHtml, /OpenAI 发布 X/);
  // The body repeats the title as a leading `# H1`; the detail page must not
  // render the headline twice (template <h1> + body <h1>).
  assert.equal((articleHtml.match(/<h1[^>]*>OpenAI 发布 X<\/h1>/g) ?? []).length, 1);
});
