import crypto from "node:crypto";

/** Slugify a title into a kebab-case ascii-ish slug. */
export function slugify(input: string): string {
  const base = input
    .normalize("NFKD")
    .toLowerCase()
    .replace(/['"`]/g, "")
    .replace(/[^a-z0-9一-鿿]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "untitled";
}

/** Date portion (YYYY-MM-DD) of an ISO timestamp. */
export function datePart(iso: string): string {
  return iso.slice(0, 10);
}

/** Build a default id from a title and timestamp: YYYY-MM-DD-slug. */
export function defaultId(title: string, iso: string): string {
  return `${datePart(iso)}-${slugify(title)}`;
}

/** Validate an article id: kebab-ish, no path separators. */
export function isValidId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-一-鿿]{0,120}$/.test(id) && !id.includes("..");
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/** Weak ETag from a content string. */
export function etagOf(content: string): string {
  return `W/"${sha256(content).slice(0, 32)}"`;
}

/** Weak ETag from binary content (uploaded assets). */
export function etagOfBytes(content: Buffer): string {
  const hex = crypto.createHash("sha256").update(content).digest("hex");
  return `W/"${hex.slice(0, 32)}"`;
}

/** Base64url encode/decode for cursors. */
export function encodeCursor(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
}
export function decodeCursor<T>(s: string): T | null {
  try {
    return JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

export function parseList(value: string | undefined | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
