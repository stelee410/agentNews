import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import crypto from "node:crypto";
import { getDb } from "../db.js";
import type { ApiKey, Role } from "../types.js";
import { nowIso, sha256 } from "../util.js";

/**
 * API keys: only the SHA-256 hash is stored (SPEC §8). Plaintext is returned
 * exactly once, at creation time. Format: an_<role>_<random>.
 */

export function generateKeyPlaintext(role: Role): string {
  const random = crypto.randomBytes(24).toString("base64url");
  return `an_${role}_${random}`;
}

function rowToKey(r: {
  id: string;
  key_hash: string;
  key_prefix: string;
  role: string;
  agent_name: string;
  created_at: string;
  revoked_at: string | null;
}): ApiKey {
  return {
    id: r.id,
    key_hash: r.key_hash,
    key_prefix: r.key_prefix,
    role: r.role as Role,
    agent_name: r.agent_name,
    created_at: r.created_at,
    revoked_at: r.revoked_at,
  };
}

/** Create a key record, returning {id, plaintext}. Plaintext is shown once. */
export function createKey(
  role: Role,
  agentName: string,
  d: Database.Database = getDb()
): { id: string; plaintext: string; prefix: string } {
  const plaintext = generateKeyPlaintext(role);
  const id = nanoid(12);
  const hash = sha256(plaintext);
  const prefix = plaintext.slice(0, 12);
  d.prepare(
    `INSERT INTO api_keys (id, key_hash, key_prefix, role, agent_name, created_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL)`
  ).run(id, hash, prefix, role, agentName, nowIso());
  return { id, plaintext, prefix };
}

/** Resolve a plaintext key to its (active) record, or null. */
export function resolveKey(plaintext: string, d: Database.Database = getDb()): ApiKey | null {
  const hash = sha256(plaintext);
  const r = d
    .prepare("SELECT * FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL")
    .get(hash) as Parameters<typeof rowToKey>[0] | undefined;
  return r ? rowToKey(r) : null;
}

export function listKeys(d: Database.Database = getDb()): ApiKey[] {
  return (
    d.prepare("SELECT * FROM api_keys ORDER BY created_at DESC").all() as Parameters<
      typeof rowToKey
    >[0][]
  ).map(rowToKey);
}

export function revokeKey(id: string, d: Database.Database = getDb()): boolean {
  const res = d
    .prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
    .run(nowIso(), id);
  return res.changes > 0;
}

export function countActiveAdmins(d: Database.Database = getDb()): number {
  return (
    d
      .prepare("SELECT count(*) AS n FROM api_keys WHERE role = 'admin' AND revoked_at IS NULL")
      .get() as { n: number }
  ).n;
}

/**
 * Bootstrap the first admin key from a provided plaintext (SPEC §8).
 * No-op if any active admin already exists. Returns true if it created one.
 */
export function bootstrapAdmin(
  plaintext: string,
  agentName = "bootstrap-admin",
  d: Database.Database = getDb()
): boolean {
  if (!plaintext) return false;
  if (countActiveAdmins(d) > 0) return false;
  const hash = sha256(plaintext);
  const existing = d.prepare("SELECT id FROM api_keys WHERE key_hash = ?").get(hash);
  if (existing) return false;
  d.prepare(
    `INSERT INTO api_keys (id, key_hash, key_prefix, role, agent_name, created_at, revoked_at)
     VALUES (?, ?, ?, 'admin', ?, ?, NULL)`
  ).run(nanoid(12), hash, plaintext.slice(0, 12), agentName, nowIso());
  return true;
}
