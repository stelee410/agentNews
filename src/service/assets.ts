import { config } from "../config.js";
import { badRequest, notFound } from "../errors.js";
import {
  assetKind,
  assetMime,
  deleteAsset,
  isValidAssetName,
  listAssets,
  writeAsset,
} from "../storage/assets.js";
import type { AssetKind } from "../storage/assets.js";
import type { AuthContext } from "../types.js";
import { assertCanMutate } from "./articles.js";

/**
 * Article image assets: validates filename/type/size/quota, enforces the same
 * ownership rules as article mutation, and writes next to the Markdown files.
 */

export function assetUrl(id: string, file: string): string {
  return `/api/v1/articles/${encodeURIComponent(id)}/assets/${encodeURIComponent(file)}`;
}

export interface AssetInfo {
  file: string;
  bytes: number;
  kind: AssetKind | "other";
  content_type: string;
  url: string;
}

export function assetList(id: string): AssetInfo[] {
  return listAssets(id).map((a) => ({
    file: a.file,
    bytes: a.bytes,
    kind: assetKind(a.file) ?? "other",
    content_type: assetMime(a.file) ?? "application/octet-stream",
    url: assetUrl(id, a.file),
  }));
}

/** PUT: create or overwrite one image asset (raw binary body). */
export function putAsset(
  id: string,
  file: string,
  data: Buffer,
  auth: AuthContext,
  contentType?: string
): AssetInfo {
  assertCanMutate(id, auth);

  if (!isValidAssetName(file)) {
    throw badRequest(
      "invalid_asset_name",
      "filename must match [a-zA-Z0-9._-], max 80 chars, no path separators",
      "file"
    );
  }
  const mime = assetMime(file);
  const kind = assetKind(file);
  if (!mime || !kind) {
    throw badRequest(
      "unsupported_asset_type",
      `extension not allowed; images: png/jpg/jpeg/webp/gif/avif · audio: mp3/m4a/aac/ogg/opus/wav/flac`,
      "file"
    );
  }
  // If the client sent a Content-Type, it must match the asset kind (or be
  // the generic octet-stream).
  const ct = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (ct && ct !== "application/octet-stream" && !ct.startsWith(`${kind}/`)) {
    throw badRequest(
      "unsupported_media_type",
      `filename is ${kind} but Content-Type is '${ct}'`
    );
  }
  if (data.length === 0) {
    throw badRequest("empty_asset", "request body is empty");
  }
  const limit = kind === "audio" ? config.maxAudioBytes : config.maxAssetBytes;
  if (data.length > limit) {
    throw badRequest("asset_too_large", `${kind} asset exceeds ${limit} bytes`);
  }
  const existing = listAssets(id);
  const isReplace = existing.some((a) => a.file === file);
  if (!isReplace && existing.length >= config.maxAssetsPerArticle) {
    throw badRequest(
      "too_many_assets",
      `article already has ${existing.length} assets (max ${config.maxAssetsPerArticle})`
    );
  }

  writeAsset(id, file, data);
  return { file, bytes: data.length, kind, content_type: mime, url: assetUrl(id, file) };
}

/** DELETE one asset; 404 if it does not exist. */
export function removeAsset(id: string, file: string, auth: AuthContext): void {
  assertCanMutate(id, auth);
  if (!deleteAsset(id, file)) {
    throw notFound(`asset '${file}' not found on article '${id}'`);
  }
}
