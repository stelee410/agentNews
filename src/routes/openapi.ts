import { Hono } from "hono";
import { config } from "../config.js";

/** Machine-readable contract for agents (SPEC §6.4). */
export const openapiRoutes = new Hono();

function spec(serverUrl: string) {
  return {
    openapi: "3.0.3",
    info: {
      title: "agentNews API",
      version: "0.1.0",
      description:
        "Agent-maintained, agent-served bilingual news & deep-content platform. Reads are open (no key) and default to bare Markdown; writes require a Bearer API key.",
    },
    servers: [{ url: serverUrl || "/" }],
    paths: {
      "/api/v1/feed": {
        get: {
          summary: "List articles (feed)",
          parameters: [
            { name: "type", in: "query", schema: { type: "string" }, description: "comma-separated types" },
            { name: "lang", in: "query", schema: { type: "string", enum: ["zh", "en"], default: "zh" } },
            { name: "tag", in: "query", schema: { type: "string" }, description: "comma-separated tags (AND)" },
            { name: "since", in: "query", schema: { type: "string", format: "date-time" } },
            { name: "limit", in: "query", schema: { type: "integer", default: 30, minimum: 1, maximum: 100 } },
            { name: "cursor", in: "query", schema: { type: "string" } },
            { name: "format", in: "query", schema: { type: "string", enum: ["md", "json"], default: "md" } },
          ],
          responses: { "200": { description: "feed list (text/markdown or json)" } },
        },
      },
      "/api/v1/articles/{id}": {
        get: {
          summary: "Get article body (bare Markdown by default)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "lang", in: "query", schema: { type: "string", enum: ["zh", "en"], default: "zh" } },
            { name: "raw", in: "query", schema: { type: "string", enum: ["1"] }, description: "strip frontmatter" },
            { name: "format", in: "query", schema: { type: "string", enum: ["json"] } },
          ],
          responses: {
            "200": { description: "article (text/markdown or json)" },
            "404": { description: "not found / language missing (see X-Available-Langs)" },
          },
        },
        put: {
          summary: "Replace an article (idempotent)",
          security: [{ bearerAuth: [] }],
          requestBody: { required: true, content: { "application/json": {} } },
          responses: { "200": { description: "updated" }, "403": { description: "forbidden" } },
        },
        patch: {
          summary: "Partially update an article",
          security: [{ bearerAuth: [] }],
          requestBody: { required: true, content: { "application/json": {} } },
          responses: { "200": { description: "updated" } },
        },
        delete: {
          summary: "Delete (soft by default, ?hard=1 to purge)",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "hard", in: "query", schema: { type: "string", enum: ["1"] } }],
          responses: { "200": { description: "archived or deleted" } },
        },
      },
      "/api/v1/articles": {
        post: {
          summary: "Create an article (raw Markdown or structured JSON body)",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                examples: {
                  raw: { value: { zh: "---\ntype: news\ntitle: 标题\nsummary: 摘要\n---\n正文", en: "---\ntype: news\ntitle: Title\nsummary: Summary\n---\nBody" } },
                  structured: {
                    value: {
                      type: "deepread",
                      tags: ["ai"],
                      sources: ["https://example.com"],
                      versions: { zh: { title: "标题", summary: "摘要", body: "# 标题\n正文" } },
                    },
                  },
                },
              },
            },
          },
          responses: { "201": { description: "created" }, "409": { description: "id conflict" } },
        },
      },
      "/api/v1/articles/{id}/assets": {
        get: {
          summary: "List uploaded assets (images + audio) of an article (open)",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "asset list (json)" }, "404": { description: "article not found" } },
        },
      },
      "/api/v1/articles/{id}/assets/{file}": {
        get: {
          summary: "Serve one uploaded image (open)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "file", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "image bytes" }, "404": { description: "not found" } },
        },
        put: {
          summary: "Upload one image or audio asset (raw binary body). Images: png/jpg/jpeg/webp/gif/avif (≤5MB). Audio (podcast): mp3/m4a/aac/ogg/opus/wav/flac (≤200MB).",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "file", in: "path", required: true, schema: { type: "string" }, description: "filename incl. extension, e.g. cover.png or episode-01.mp3" },
          ],
          requestBody: {
            required: true,
            content: {
              "image/*": { schema: { type: "string", format: "binary" } },
              "audio/*": { schema: { type: "string", format: "binary" } },
            },
          },
          responses: {
            "201": { description: "stored; returns {file, bytes, content_type, url}" },
            "400": { description: "bad filename / type / size / quota" },
            "403": { description: "forbidden (not owner)" },
          },
        },
        delete: {
          summary: "Delete one uploaded image",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "file", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "deleted" }, "404": { description: "not found" } },
        },
      },
      "/api/v1/types": {
        get: { summary: "List content types (open)", responses: { "200": { description: "ok" } } },
        post: {
          summary: "Create content type (admin)",
          security: [{ bearerAuth: [] }],
          responses: { "201": { description: "created" } },
        },
      },
      "/api/v1/keys": {
        get: { summary: "List keys (admin)", security: [{ bearerAuth: [] }], responses: { "200": { description: "ok" } } },
        post: { summary: "Issue editor key (admin)", security: [{ bearerAuth: [] }], responses: { "201": { description: "created" } } },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", description: "an_<role>_<random> API key" },
      },
    },
  };
}

openapiRoutes.get("/openapi.json", (c) => {
  const serverUrl = config.baseUrl || new URL(c.req.url).origin;
  return c.json(spec(serverUrl));
});
