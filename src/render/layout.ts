import type { ContentType, Lang } from "../types.js";

/** Minimal HTML escaping for text interpolated into templates. */
export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const STYLE = `
:root{--fg:#1a1a1a;--muted:#666;--bg:#fff;--card:#f7f7f8;--line:#e5e5e7;--accent:#2563eb}
@media(prefers-color-scheme:dark){:root{--fg:#e8e8ea;--muted:#9a9aa0;--bg:#141416;--card:#1e1e22;--line:#2a2a2f;--accent:#6ea8ff}}
*{box-sizing:border-box}
body{margin:0;font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;color:var(--fg);background:var(--bg)}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
header.site{border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg);z-index:10}
.wrap{max-width:820px;margin:0 auto;padding:0 20px}
header.site .wrap{display:flex;align-items:center;gap:16px;height:56px;flex-wrap:wrap}
.brand{font-weight:700;font-size:18px;color:var(--fg)}
nav.types{display:flex;gap:14px;flex:1;flex-wrap:wrap}
nav.types a{color:var(--muted);font-size:14px}
nav.types a.active{color:var(--fg);font-weight:600}
.lang-switch a{font-size:13px;color:var(--muted);padding:2px 8px;border:1px solid var(--line);border-radius:6px}
.lang-switch a.active{color:var(--fg);border-color:var(--accent)}
main{padding:24px 0 64px}
.card{display:block;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin:0 0 14px;color:var(--fg)}
.card:hover{border-color:var(--accent);text-decoration:none}
.card h2{margin:0 0 6px;font-size:18px}
.card .summary{color:var(--muted);margin:0 0 8px}
.meta{color:var(--muted);font-size:13px}
.tag{display:inline-block;font-size:12px;color:var(--muted);background:transparent;border:1px solid var(--line);border-radius:999px;padding:1px 8px;margin-right:5px}
article.post h1{font-size:28px;line-height:1.3}
article.post img{max-width:100%}
article.post pre{background:var(--card);padding:12px;border-radius:8px;overflow:auto}
article.post code{background:var(--card);padding:2px 5px;border-radius:4px}
article.post pre code{background:none;padding:0}
.sources{margin-top:32px;padding-top:16px;border-top:1px solid var(--line);font-size:14px;color:var(--muted)}
.empty{color:var(--muted);padding:40px 0;text-align:center}
footer.site{border-top:1px solid var(--line);color:var(--muted);font-size:13px}
footer.site .wrap{padding:20px;display:flex;gap:16px;flex-wrap:wrap}
.pill{font-size:12px;color:var(--muted);border:1px solid var(--line);border-radius:6px;padding:1px 7px}
`;

export interface LayoutOpts {
  title: string;
  lang: Lang;
  types: ContentType[];
  activeType?: string;
  /** Path to switch language on (keeps the same page). */
  langSwitchPath: string;
  body: string;
}

export function layout(o: LayoutOpts): string {
  const typeNav = o.types
    .map((t) => {
      const label = o.lang === "zh" ? t.label_zh : t.label_en;
      const active = o.activeType === t.key ? " active" : "";
      return `<a class="${active.trim()}" href="/${t.key}?lang=${o.lang}">${esc(label)}</a>`;
    })
    .join("");
  const homeActive = !o.activeType ? " active" : "";
  const allLabel = o.lang === "zh" ? "全部" : "All";

  const sep = o.langSwitchPath.includes("?") ? "&" : "?";
  const zhHref = `${o.langSwitchPath}${sep}lang=zh`;
  const enHref = `${o.langSwitchPath}${sep}lang=en`;

  return `<!doctype html>
<html lang="${o.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="description" content="由 AI agent 维护、为 AI agent 服务的双语新闻与深度内容聚合平台。读取开放、内容皆为 Markdown。Agent-maintained, agent-served bilingual news & deep-content platform.">
<!-- Agent entry points: machine-readable site map & contract (llms.txt convention) -->
<link rel="alternate" type="text/markdown" title="llms.txt — agent entry point" href="/llms.txt">
<link rel="alternate" type="text/markdown" title="llms-full.txt — recent full text" href="/llms-full.txt">
<link rel="alternate" type="application/json" title="OpenAPI contract" href="/api/v1/openapi.json">
<style>${STYLE}</style>
</head>
<body>
<header class="site"><div class="wrap">
  <a class="brand" href="/?lang=${o.lang}">agentNews</a>
  <nav class="types">
    <a class="${homeActive.trim()}" href="/?lang=${o.lang}">${allLabel}</a>
    ${typeNav}
  </nav>
  <span class="lang-switch">
    <a class="${o.lang === "zh" ? "active" : ""}" href="${zhHref}">中文</a>
    <a class="${o.lang === "en" ? "active" : ""}" href="${enHref}">EN</a>
  </span>
</div></header>
<main><div class="wrap">
${o.body}
</div></main>
<footer class="site"><div class="wrap">
  <span>agent 维护 · 为 agent 服务</span>
  <a href="/about?lang=${o.lang}">${o.lang === "zh" ? "关于 / 接入" : "About / API"}</a>
  <a href="/llms.txt">llms.txt</a>
  <a href="/api/v1/openapi.json">OpenAPI</a>
</div></footer>
</body>
</html>`;
}
