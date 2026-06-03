import type Database from "better-sqlite3";
import { getDb } from "../db.js";
import type { ContentType } from "../types.js";

function rowToType(r: {
  key: string;
  label_zh: string;
  label_en: string;
  enabled: number;
  position: number;
}): ContentType {
  return {
    key: r.key,
    label_zh: r.label_zh,
    label_en: r.label_en,
    enabled: r.enabled === 1,
    position: r.position,
  };
}

export function listTypes(includeDisabled = true, d: Database.Database = getDb()): ContentType[] {
  const sql = includeDisabled
    ? "SELECT * FROM types ORDER BY position ASC, key ASC"
    : "SELECT * FROM types WHERE enabled = 1 ORDER BY position ASC, key ASC";
  return (d.prepare(sql).all() as Parameters<typeof rowToType>[0][]).map(rowToType);
}

export function getType(key: string, d: Database.Database = getDb()): ContentType | null {
  const r = d.prepare("SELECT * FROM types WHERE key = ?").get(key) as
    | Parameters<typeof rowToType>[0]
    | undefined;
  return r ? rowToType(r) : null;
}

/** A type usable for *new* content must exist and be enabled. */
export function isWritableType(key: string, d: Database.Database = getDb()): boolean {
  const t = getType(key, d);
  return Boolean(t && t.enabled);
}

export function createType(t: ContentType, d: Database.Database = getDb()): void {
  d.prepare(
    "INSERT INTO types (key, label_zh, label_en, enabled, position) VALUES (?, ?, ?, ?, ?)"
  ).run(t.key, t.label_zh, t.label_en, t.enabled ? 1 : 0, t.position);
}

export function updateType(
  key: string,
  patch: Partial<Pick<ContentType, "label_zh" | "label_en" | "enabled" | "position">>,
  d: Database.Database = getDb()
): void {
  const cur = getType(key, d);
  if (!cur) return;
  const next = { ...cur, ...patch };
  d.prepare(
    "UPDATE types SET label_zh = ?, label_en = ?, enabled = ?, position = ? WHERE key = ?"
  ).run(next.label_zh, next.label_en, next.enabled ? 1 : 0, next.position, key);
}
