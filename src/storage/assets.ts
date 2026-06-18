import fs from "node:fs";
import path from "node:path";
import { findArticleDir } from "./articles.js";

/**
 * Article image assets: content/<type>/<id>/assets/<file>.
 * Stored next to the Markdown source of truth so an article directory is
 * self-contained (assets travel with the article on type change / hard delete).
 */

export type AssetKind = "image" | "audio";

/**
 * Allowed raster image extensions -> served Content-Type.
 * SVG is deliberately excluded: served same-origin it can execute scripts.
 */
export const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

/** Allowed audio extensions (podcast episodes) -> served Content-Type. */
export const AUDIO_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  wav: "audio/wav",
  flac: "audio/flac",
};

/** Safe asset filename: no paths, sane charset, an extension we know. */
export function isValidAssetName(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(name) && !name.includes("..");
}

/** Content-Type for an asset filename, or null if the extension is not allowed. */
export function assetMime(name: string): string | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_MIME[ext] ?? AUDIO_MIME[ext] ?? null;
}

/** Whether a filename is an image, audio, or neither. */
export function assetKind(name: string): AssetKind | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (IMAGE_MIME[ext]) return "image";
  if (AUDIO_MIME[ext]) return "audio";
  return null;
}

function assetsDir(id: string): string | null {
  const dir = findArticleDir(id);
  return dir ? path.join(dir, "assets") : null;
}

export function listAssets(id: string): { file: string; bytes: number }[] {
  const dir = assetsDir(id);
  if (!dir || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => isValidAssetName(f) && assetMime(f))
    .sort()
    .map((f) => ({ file: f, bytes: fs.statSync(path.join(dir, f)).size }));
}

export function readAsset(id: string, file: string): Buffer | null {
  if (!isValidAssetName(file)) return null;
  const dir = assetsDir(id);
  if (!dir) return null;
  const p = path.join(dir, file);
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
}

export function writeAsset(id: string, file: string, data: Buffer): void {
  const dir = assetsDir(id);
  if (!dir) throw new Error(`article '${id}' not found on disk`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), data);
}

/** Returns false if the asset did not exist. */
export function deleteAsset(id: string, file: string): boolean {
  if (!isValidAssetName(file)) return false;
  const dir = assetsDir(id);
  if (!dir) return false;
  const p = path.join(dir, file);
  if (!fs.existsSync(p)) return false;
  fs.rmSync(p);
  return true;
}
