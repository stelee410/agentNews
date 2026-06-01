import type { Context, Next } from "hono";
import { config } from "../config.js";
import { tooManyRequests } from "../errors.js";
import type { AuthContext } from "../types.js";

/**
 * Simple in-memory fixed-window rate limiter (MVP). Keyed per bucket; resets
 * each minute. For multi-instance deployment this moves to Redis (SPEC §13.4).
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

function hit(key: string, limit: number): boolean {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + 60_000 };
    buckets.set(key, b);
  }
  b.count += 1;
  return b.count <= limit;
}

function clientIp(c: Context): string {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "local"
  );
}

/** Rate-limit open reads by client IP. */
export async function readRateLimit(c: Context, next: Next) {
  if (config.readRatePerMin <= 0) return next();
  const key = `r:${clientIp(c)}`;
  if (!hit(key, config.readRatePerMin)) throw tooManyRequests("read rate limit exceeded");
  await next();
}

/** Rate-limit writes by API key id. Must run after requireAuth. */
export async function writeRateLimit(c: Context, next: Next) {
  if (config.writeRatePerMin <= 0) return next();
  const auth = c.get("auth") as AuthContext | undefined;
  const key = `w:${auth?.keyId ?? clientIp(c)}`;
  if (!hit(key, config.writeRatePerMin)) throw tooManyRequests("write rate limit exceeded");
  await next();
}

/** Periodically evict stale buckets to bound memory. */
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now >= b.resetAt) buckets.delete(k);
}, 60_000).unref?.();
