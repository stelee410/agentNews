import { z } from "zod";
import { LANGS } from "./types.js";

/**
 * Zod schemas for write request bodies (SPEC §6.2). Two input shapes are
 * supported for create: (A) raw per-language Markdown, (B) structured JSON.
 */

const tag = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "tags must be lowercase kebab-case");

const langEnum = z.enum(["zh", "en"] as [string, ...string[]]);

/** A structured single-language version. */
export const versionInput = z.object({
  title: z.string().min(1).max(300),
  summary: z.string().min(1).max(500),
  body: z.string().min(1),
});

/** (B) structured JSON create/replace body. */
export const structuredArticleInput = z.object({
  id: z.string().optional(),
  type: z.string().min(1),
  tags: z.array(tag).max(30).optional(),
  sources: z.array(z.string().url()).max(50).optional(),
  related: z.array(z.string()).max(50).optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
  versions: z.record(langEnum, versionInput),
});

/** (A) raw Markdown create body: { zh?: "...", en?: "..." }. */
export const rawMarkdownInput = z
  .object({
    zh: z.string().optional(),
    en: z.string().optional(),
  })
  .refine((o) => LANGS.some((l) => o[l]), {
    message: "at least one of zh / en is required",
  });

/** PATCH body: any subset of fields. */
export const patchArticleInput = z.object({
  type: z.string().min(1).optional(),
  tags: z.array(tag).max(30).optional(),
  sources: z.array(z.string().url()).max(50).optional(),
  related: z.array(z.string()).max(50).optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
  versions: z.record(langEnum, versionInput.partial()).optional(),
});

/** Admin: create content type. */
export const createTypeInput = z.object({
  key: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[a-z][a-z0-9-]*$/, "key must be lowercase kebab-case"),
  label_zh: z.string().min(1).max(40),
  label_en: z.string().min(1).max(40),
  position: z.number().int().min(0).max(100000).optional(),
});

export const patchTypeInput = z.object({
  label_zh: z.string().min(1).max(40).optional(),
  label_en: z.string().min(1).max(40).optional(),
  enabled: z.boolean().optional(),
  position: z.number().int().min(0).max(100000).optional(),
});

/** Admin: issue editor key. */
export const createKeyInput = z.object({
  agent_name: z.string().min(1).max(120),
  role: z.enum(["editor", "admin"]).optional(),
});

export type StructuredArticleInput = z.infer<typeof structuredArticleInput>;
export type RawMarkdownInput = z.infer<typeof rawMarkdownInput>;
export type PatchArticleInput = z.infer<typeof patchArticleInput>;
