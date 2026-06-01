import { Hono } from "hono";
import { ZodError } from "zod";
import { audit, getDb } from "../db.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { getAuth, requireAuth, requireRole } from "../middleware/auth.js";
import { writeRateLimit } from "../middleware/ratelimit.js";
import { createKeyInput, createTypeInput, patchTypeInput } from "../schema.js";
import {
  createType,
  getType,
  listTypes,
  updateType,
} from "../storage/content-types.js";
import { createKey, listKeys, revokeKey } from "../storage/keys.js";

/**
 * Admin API (SPEC §6.5). Content-type management + editor-key management.
 * All mutating routes require the 'admin' role; type listing is open.
 */
export const typesPublicRoutes = new Hono();
export const adminRoutes = new Hono();

function zod(e: unknown): never {
  if (e instanceof ZodError) {
    const first = e.issues[0];
    throw badRequest("invalid_body", first?.message ?? "validation failed", first?.path.join("."));
  }
  throw e;
}

// --- Public: list types (open read) ---
typesPublicRoutes.get("/types", (c) => {
  return c.json({ types: listTypes(true) });
});

// --- Admin-only below ---
// Applied per-route (not via use("*")) to avoid leaking onto sibling mounts.
const adminGuard = [requireAuth, requireRole("admin"), writeRateLimit] as const;

// POST /api/v1/types
adminRoutes.post("/types", ...adminGuard, async (c) => {
  const auth = getAuth(c);
  let input;
  try {
    input = createTypeInput.parse(await c.req.json());
  } catch (e) {
    zod(e);
  }
  if (getType(input.key)) throw conflict("type_exists", `type '${input.key}' already exists`);
  createType({ ...input, enabled: true });
  audit(getDb(), auth.agentName, "type_create", input.key);
  return c.json({ type: getType(input.key) }, 201);
});

// PATCH /api/v1/types/:key
adminRoutes.patch("/types/:key", ...adminGuard, async (c) => {
  const auth = getAuth(c);
  const key = c.req.param("key") as string;
  if (!getType(key)) throw notFound(`type '${key}' not found`);
  let patch;
  try {
    patch = patchTypeInput.parse(await c.req.json());
  } catch (e) {
    zod(e);
  }
  updateType(key, patch);
  audit(getDb(), auth.agentName, "type_update", key, JSON.stringify(patch));
  return c.json({ type: getType(key) });
});

// POST /api/v1/types/:key/disable
adminRoutes.post("/types/:key/disable", ...adminGuard, (c) => {
  const auth = getAuth(c);
  const key = c.req.param("key") as string;
  if (!getType(key)) throw notFound(`type '${key}' not found`);
  updateType(key, { enabled: false });
  audit(getDb(), auth.agentName, "type_disable", key);
  return c.json({ type: getType(key) });
});

// POST /api/v1/keys — issue an editor (or admin) key
adminRoutes.post("/keys", ...adminGuard, async (c) => {
  const auth = getAuth(c);
  let input;
  try {
    input = createKeyInput.parse(await c.req.json());
  } catch (e) {
    zod(e);
  }
  const role = input.role ?? "editor";
  const { id, plaintext, prefix } = createKey(role, input.agent_name);
  audit(getDb(), auth.agentName, "key_issue", id, `${role}:${input.agent_name}`);
  // Plaintext is returned exactly once.
  return c.json(
    {
      id,
      role,
      agent_name: input.agent_name,
      key: plaintext,
      prefix,
      warning: "Store this key now — it will not be shown again.",
    },
    201
  );
});

// GET /api/v1/keys — list (metadata only, never plaintext)
adminRoutes.get("/keys", ...adminGuard, (c) => {
  const keys = listKeys().map((k) => ({
    id: k.id,
    role: k.role,
    agent_name: k.agent_name,
    prefix: k.key_prefix,
    created_at: k.created_at,
    revoked_at: k.revoked_at,
    active: k.revoked_at === null,
  }));
  return c.json({ keys });
});

// DELETE /api/v1/keys/:id — revoke
adminRoutes.delete("/keys/:id", ...adminGuard, (c) => {
  const auth = getAuth(c);
  const id = c.req.param("id") as string;
  const ok = revokeKey(id);
  if (!ok) throw notFound(`key '${id}' not found or already revoked`);
  audit(getDb(), auth.agentName, "key_revoke", id);
  return c.json({ id, revoked: true });
});
