/** Core domain types for agentNews. */

export type Lang = "zh" | "en";
export const LANGS: Lang[] = ["zh", "en"];

export type Role = "admin" | "editor";

export type ArticleStatus = "draft" | "published" | "archived";

/** Frontmatter + body for a single language version of an article. */
export interface Version {
  lang: Lang;
  title: string;
  summary: string;
  body: string;
}

/** Article-level metadata shared across language versions. */
export interface Article {
  id: string;
  type: string;
  status: ArticleStatus;
  tags: string[];
  sources: string[];
  related: string[];
  author_agent: string;
  created_at: string; // ISO-8601 UTC
  updated_at: string; // ISO-8601 UTC
  versions: Partial<Record<Lang, Version>>;
}

/** A content type as managed by admin agents. */
export interface ContentType {
  key: string;
  label_zh: string;
  label_en: string;
  enabled: boolean;
  position: number;
}

/** API key record (only the hash is stored). */
export interface ApiKey {
  id: string;
  key_hash: string;
  key_prefix: string;
  role: Role;
  agent_name: string;
  created_at: string;
  revoked_at: string | null;
}

/** Compact feed row, projected from the index. */
export interface FeedRow {
  id: string;
  type: string;
  title: string;
  summary: string;
  tags: string[];
  updated_at: string;
  available_langs: Lang[];
}

export interface AuthContext {
  keyId: string;
  role: Role;
  agentName: string;
}
