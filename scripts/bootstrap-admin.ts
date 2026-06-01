import { getDb } from "../src/db.js";
import { createKey, countActiveAdmins } from "../src/storage/keys.js";

/**
 * One-time CLI to mint the first admin key (alternative to the
 * AGENTNEWS_BOOTSTRAP_ADMIN env var). Prints the plaintext once.
 *
 *   pnpm bootstrap [agent_name]
 */
function main() {
  const db = getDb();
  if (countActiveAdmins(db) > 0) {
    console.error("An active admin key already exists. Refusing to mint another.");
    console.error("Revoke the existing one via the API if you really need to rotate.");
    process.exit(1);
  }
  const agentName = process.argv[2] || "bootstrap-admin";
  const { id, plaintext, prefix } = createKey("admin", agentName);
  console.log("Created admin key (store it now — shown once):\n");
  console.log(`  id:      ${id}`);
  console.log(`  prefix:  ${prefix}`);
  console.log(`  agent:   ${agentName}`);
  console.log(`  KEY:     ${plaintext}\n`);
}

main();
