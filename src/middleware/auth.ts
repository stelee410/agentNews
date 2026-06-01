import type { Context, Next } from "hono";
import { forbidden, unauthorized } from "../errors.js";
import { resolveKey } from "../storage/keys.js";
import type { AuthContext, Role } from "../types.js";

/**
 * Extract a Bearer token, resolve it to an AuthContext, and stash it on the
 * context. Throws 401 if missing/invalid. Use requireRole() to gate by role.
 */
export async function requireAuth(c: Context, next: Next) {
  const header = c.req.header("authorization") ?? "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) throw unauthorized("expected 'Authorization: Bearer <API_KEY>'");
  const key = resolveKey(m[1].trim());
  if (!key) throw unauthorized("invalid or revoked API key");
  const auth: AuthContext = { keyId: key.id, role: key.role, agentName: key.agent_name };
  c.set("auth", auth);
  await next();
}

export function requireRole(role: Role) {
  return async (c: Context, next: Next) => {
    const auth = c.get("auth") as AuthContext | undefined;
    if (!auth) throw unauthorized();
    if (auth.role !== role) throw forbidden(`requires '${role}' role`);
    await next();
  };
}

export function getAuth(c: Context): AuthContext {
  const auth = c.get("auth") as AuthContext | undefined;
  if (!auth) throw unauthorized();
  return auth;
}
