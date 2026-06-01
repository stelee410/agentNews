import { Hono } from "hono";
import { compress } from "hono/compress";
import { logger } from "hono/logger";
import { ApiError, sendError } from "./errors.js";
import { readRateLimit } from "./middleware/ratelimit.js";
import { adminRoutes, typesPublicRoutes } from "./routes/admin.js";
import { llmsRoutes } from "./routes/llms.js";
import { openapiRoutes } from "./routes/openapi.js";
import { readRoutes } from "./routes/read.js";
import { webRoutes } from "./routes/web.js";
import { writeRoutes } from "./routes/write.js";

/**
 * Assemble the single-process Hono app: read API, write API, admin API,
 * llms.txt, OpenAPI, and the human Web UI (SPEC §10).
 */
export function createApp() {
  const app = new Hono();

  app.use("*", logger());
  app.use("*", compress());

  // Uniform error envelope (SPEC §6.3).
  app.onError((err, c) => {
    if (!(err instanceof ApiError)) {
      console.error("[unhandled]", err);
    }
    return sendError(c, err);
  });

  app.get("/health", (c) => c.json({ ok: true }));

  // --- API v1 ---
  // Open reads are rate-limited by IP; writes/admin carry their own limiter.
  app.use("/api/v1/feed", readRateLimit);
  app.use("/api/v1/articles/*", async (c, next) => {
    if (c.req.method === "GET") return readRateLimit(c, next);
    return next();
  });

  app.route("/api/v1", readRoutes); // GET feed, articles, aliases
  app.route("/api/v1", typesPublicRoutes); // GET types (open)
  app.route("/api/v1", openapiRoutes); // openapi.json
  app.route("/api/v1", writeRoutes); // POST/PUT/PATCH/DELETE articles
  app.route("/api/v1", adminRoutes); // types + keys management

  // --- Agent entry points at root ---
  app.use("/llms.txt", readRateLimit);
  app.use("/llms-full.txt", readRateLimit);
  app.route("/", llmsRoutes);

  // --- Human Web UI (catch-all /:type must come last) ---
  app.route("/", webRoutes);

  return app;
}
