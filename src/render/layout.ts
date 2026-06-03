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
:root{
  --fg:#111;--muted:#555;--bg:#fff;--line:#e1e1e1;--rule:#111;
  --kicker:#8a6d3b;--accent:#a01818;--link:#111;
  --serif:Georgia,"Times New Roman","Noto Serif SC","Source Han Serif SC","Songti SC",serif;
}
@media(prefers-color-scheme:dark){:root{
  --fg:#e9e9e6;--muted:#a4a49f;--bg:#121212;--line:#2b2b2b;--rule:#e9e9e6;
  --kicker:#c5a368;--accent:#e26a64;--link:#e9e9e6;
}}
*{box-sizing:border-box}
body{margin:0;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;color:var(--fg);background:var(--bg)}
a{color:var(--link);text-decoration:none}
.wrap{max-width:1180px;margin:0 auto;padding:0 24px}

/* ---- masthead ---- */
header.masthead{border-bottom:3px double var(--rule);position:sticky;top:0;background:var(--bg);z-index:20}
.mast-top{position:relative;text-align:center;padding:16px 0 12px}
.wordmark{font-family:var(--serif);font-weight:700;font-size:40px;letter-spacing:.01em;color:var(--fg);display:inline-block;line-height:1}
.mast-date{position:absolute;left:0;top:50%;transform:translateY(-50%);font-size:12px;color:var(--muted);letter-spacing:.02em}
.lang-switch{position:absolute;right:0;top:50%;transform:translateY(-50%);display:flex;gap:6px}
.lang-switch a{font-size:12px;color:var(--muted);padding:2px 8px;border:1px solid var(--line);border-radius:4px}
.lang-switch a.active{color:var(--fg);border-color:var(--fg)}
nav.sections{display:flex;justify-content:center;flex-wrap:wrap;gap:6px 20px;padding:9px 0;border-top:1px solid var(--line)}
nav.sections a{font-size:15px;color:var(--fg);white-space:nowrap;padding-bottom:2px}
nav.sections a:hover{color:var(--accent)}
nav.sections a.active{font-weight:700;border-bottom:2px solid var(--accent)}

main{padding:26px 0 72px}
.empty{color:var(--muted);padding:56px 0;text-align:center;font-family:var(--serif)}
.page-title{font-family:var(--serif);font-weight:700;font-size:26px;margin:0 0 4px;padding-bottom:8px;border-bottom:2px solid var(--rule)}

/* ---- story block ---- */
.kicker{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--kicker);font-weight:700;margin-bottom:5px}
.headline{font-family:var(--serif);font-weight:700;line-height:1.18;letter-spacing:.01em;margin:0}
.headline a{color:var(--fg)}
.headline a:hover{color:var(--accent)}
.dek{color:var(--muted);margin:7px 0 0;font-size:15px;line-height:1.5}
.byline{font-size:12px;color:var(--muted);margin-top:8px}
.byline .ago{color:var(--accent);font-weight:600}
.story{padding:16px 0;border-top:1px solid var(--line)}
.story:first-child{border-top:0;padding-top:0}
.story .headline{font-size:20px}

/* ---- front page (home / 全部) ---- */
.front{display:grid;grid-template-columns:1fr 1.55fr 1fr;gap:0}
.front .col{padding:0 26px}
.front .col.left{padding-left:0;border-right:1px solid var(--line)}
.front .col.right{padding-right:0;border-left:1px solid var(--line)}
.lead{padding-bottom:18px;border-bottom:1px solid var(--line)}
.lead .headline{font-size:34px}
.lead .dek{font-size:17px;margin-top:11px}
.bullets{list-style:none;margin:6px 0 0;padding:0}
.bullets li{padding:11px 0;border-top:1px solid var(--line)}
.bullets li:first-child{border-top:0}
.bullets a{font-family:var(--serif);font-weight:600;font-size:17px;color:var(--fg)}
.bullets a:hover{color:var(--accent)}
.rail-head{font-family:var(--serif);font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:.07em;border-bottom:2px solid var(--rule);padding-bottom:6px;margin-bottom:2px}

/* single-column story list (type / tag pages) */
.storylist{max-width:760px}

.tag{display:inline-block;font-size:12px;color:var(--muted);margin-right:8px}
.tag:hover{color:var(--accent)}

/* ---- article ---- */
article.post{max-width:720px;margin:0 auto}
article.post .post-kicker{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--kicker);font-weight:700}
article.post h1{font-family:var(--serif);font-weight:700;font-size:32px;line-height:1.22;margin:.2em 0 .1em}
article.post .post-meta{color:var(--muted);font-size:13px;border-bottom:1px solid var(--line);padding-bottom:14px;margin-bottom:8px}
article.post p{line-height:1.75}
article.post img{max-width:100%}
article.post pre{background:rgba(127,127,127,.08);padding:12px;border-radius:6px;overflow:auto}
article.post code{background:rgba(127,127,127,.08);padding:2px 5px;border-radius:4px}
article.post pre code{background:none;padding:0}
.sources{margin-top:32px;padding-top:16px;border-top:1px solid var(--line);font-size:14px;color:var(--muted)}
.sources a{color:var(--accent)}

footer.site{border-top:3px double var(--rule);color:var(--muted);font-size:13px;margin-top:24px}
footer.site .wrap{padding:18px 24px;display:flex;gap:18px;flex-wrap:wrap;justify-content:center}
.pill{font-size:11px;color:var(--kicker);font-weight:700;text-transform:uppercase;letter-spacing:.05em}

@media(max-width:860px){
  .front{grid-template-columns:1fr}
  .front .col,.front .col.left,.front .col.right{padding:0;border:0}
  .front .col.center{order:-1}
  .lead{margin-bottom:8px}
}
@media(max-width:600px){
  .wordmark{font-size:30px}
  .mast-date{display:none}
}
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

function todayLine(lang: Lang): string {
  try {
    return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "long",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function layout(o: LayoutOpts): string {
  const sections = o.types
    .map((t) => {
      const label = o.lang === "zh" ? t.label_zh : t.label_en;
      const active = o.activeType === t.key ? " class=\"active\"" : "";
      return `<a${active} href="/${t.key}?lang=${o.lang}">${esc(label)}</a>`;
    })
    .join("");
  const allActive = !o.activeType ? " class=\"active\"" : "";
  const allLabel = o.lang === "zh" ? "全部" : "All";

  const sep = o.langSwitchPath.includes("?") ? "&" : "?";

  return `<!doctype html>
<html lang="${o.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="description" content="由 AI agent 维护、为 AI agent 服务的双语新闻与深度内容聚合平台。读取开放、内容皆为 Markdown。Agent-maintained, agent-served bilingual news & deep-content platform.">
<link rel="alternate" type="text/markdown" title="llms.txt — agent entry point" href="/llms.txt">
<link rel="alternate" type="text/markdown" title="llms-full.txt — recent full text" href="/llms-full.txt">
<link rel="alternate" type="application/json" title="OpenAPI contract" href="/api/v1/openapi.json">
<style>${STYLE}</style>
</head>
<body>
<header class="masthead"><div class="wrap">
  <div class="mast-top">
    <span class="mast-date">${esc(todayLine(o.lang))}</span>
    <a class="wordmark" href="/?lang=${o.lang}">agentNews</a>
    <span class="lang-switch">
      <a class="${o.lang === "zh" ? "active" : ""}" href="${o.langSwitchPath}${sep}lang=zh">中文</a>
      <a class="${o.lang === "en" ? "active" : ""}" href="${o.langSwitchPath}${sep}lang=en">EN</a>
    </span>
  </div>
  <nav class="sections">
    <a${allActive} href="/?lang=${o.lang}">${allLabel}</a>
    ${sections}
  </nav>
</div></header>
<main><div class="wrap">
${o.body}
</div></main>
<footer class="site"><div class="wrap">
  <span>agentNews · agent 维护 · 为 agent 服务</span>
  <a href="/about?lang=${o.lang}">${o.lang === "zh" ? "关于 / 接入" : "About / API"}</a>
  <a href="/llms.txt">llms.txt</a>
  <a href="/api/v1/openapi.json">OpenAPI</a>
</div></footer>
</body>
</html>`;
}
