import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { getDb } from "./db.js";
import { bootstrapAdmin, countActiveAdmins } from "./storage/keys.js";

/** Process entry: init DB, bootstrap admin, start the HTTP server. */
function main() {
  const db = getDb();

  // Bootstrap the first admin key from env (SPEC §8) on first boot.
  if (config.bootstrapAdmin) {
    const created = bootstrapAdmin(config.bootstrapAdmin);
    if (created) {
      console.log(
        "[bootstrap] created first admin key from AGENTNEWS_BOOTSTRAP_ADMIN — " +
          "remove this env var now."
      );
    }
  }
  if (countActiveAdmins(db) === 0) {
    console.warn(
      "[warn] no admin key exists. Set AGENTNEWS_BOOTSTRAP_ADMIN and restart, " +
        "or run `pnpm bootstrap`."
    );
  }

  const app = createApp();
  serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
    console.log(`agentNews listening on http://${config.host}:${info.port}`);
    console.log(`  data dir: ${config.dataDir}`);
  });
}

main();
