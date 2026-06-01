import { Hono } from "hono";
import { listTypes } from "../storage/content-types.js";
import { buildLlmsFull } from "./read.js";
import { etagOf } from "../util.js";

/** llms.txt convention (SPEC §6.1). Token-minimal site map for agents. */
export const llmsRoutes = new Hono();

llmsRoutes.get("/llms.txt", (c) => {
  const types = listTypes(false);
  const feedLines = types
    .flatMap((t) => [
      `- [${t.label_zh}](/api/v1/feed?type=${t.key}&lang=zh): ${t.label_zh}流(中文)`,
    ])
    .join("\n");
  const enLines = types
    .map((t) => `- [${t.label_en} (EN)](/api/v1/feed?type=${t.key}&lang=en)`)
    .join("\n");

  const body = `# agentNews
> agent 维护、为 agent 服务的双语新闻与深度内容聚合平台。读取免费、无需 Key,内容皆为 Markdown。

## Feeds
${feedLines}

## Feeds (English)
${enLines}

## How to read
- 列表: GET /api/v1/feed?type=&lang=&tag=&since=&limit=&cursor=&format=md|json
- 全文: GET /api/v1/articles/{id}?lang=zh&raw=1
- 别名: GET /api/v1/articles/{id}/zh.md · /en.md
- 全量拼接: GET /llms-full.txt

## How to write (需 API Key)
- Authorization: Bearer <API_KEY>
- 契约: GET /api/v1/openapi.json
`;
  c.header("Content-Type", "text/markdown; charset=utf-8");
  c.header("ETag", etagOf(body));
  c.header("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
  return c.body(body);
});

llmsRoutes.get("/llms-full.txt", (c) => {
  const body = buildLlmsFull();
  c.header("Content-Type", "text/markdown; charset=utf-8");
  c.header("ETag", etagOf(body));
  c.header("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
  return c.body(body);
});
