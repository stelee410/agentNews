import path from "node:path";

/**
 * Runtime configuration, sourced from environment variables.
 * Sensible defaults keep the MVP a zero-config single-process server.
 */
function int(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

const dataDir = path.resolve(process.env.AGENTNEWS_DATA_DIR ?? "./data");

export const config = {
  /** Bind host / port for the HTTP server. */
  host: process.env.HOST ?? "0.0.0.0",
  port: int("PORT", 3000),

  /** Public base URL, used to build absolute links in llms.txt / OpenAPI. */
  baseUrl: (process.env.AGENTNEWS_BASE_URL ?? "").replace(/\/$/, ""),

  /** Root of the runtime data dir. Holds content/ and index.db. */
  dataDir,
  contentDir: path.join(dataDir, "content"),
  dbPath: path.join(dataDir, "index.db"),

  /**
   * Bootstrap admin key. On first boot, if no admin key exists in the DB,
   * a key derived from this value is created. Clear from env afterwards.
   */
  bootstrapAdmin: process.env.AGENTNEWS_BOOTSTRAP_ADMIN ?? "",

  /** Body size limit per language version, in bytes. */
  maxBodyBytes: int("AGENTNEWS_MAX_BODY_BYTES", 256 * 1024),

  /** Per-image size limit for uploaded article assets, in bytes. */
  maxAssetBytes: int("AGENTNEWS_MAX_ASSET_BYTES", 5 * 1024 * 1024),
  /** Per-audio size limit (podcast episodes), in bytes. */
  maxAudioBytes: int("AGENTNEWS_MAX_AUDIO_BYTES", 200 * 1024 * 1024),
  /** Max number of uploaded assets per article. */
  maxAssetsPerArticle: int("AGENTNEWS_MAX_ASSETS_PER_ARTICLE", 20),

  /** Read rate limit: requests per minute per client (IP). */
  readRatePerMin: int("AGENTNEWS_READ_RATE", 120),
  /** Write rate limit: writes per minute per key. */
  writeRatePerMin: int("AGENTNEWS_WRITE_RATE", 30),

  /** Cache-Control max-age for open GET responses, in seconds. */
  cacheMaxAge: int("AGENTNEWS_CACHE_MAX_AGE", 60),
  cacheSwr: int("AGENTNEWS_CACHE_SWR", 600),

  /** Number of recent articles concatenated into llms-full.txt. */
  llmsFullLimit: int("AGENTNEWS_LLMS_FULL_LIMIT", 50),
} as const;

export type Config = typeof config;
