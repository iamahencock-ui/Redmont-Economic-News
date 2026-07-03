// ---------------------------------------------------------------------------
// ui.js — shared layout & components in the approved broadsheet style.
// All colors/fonts are CSS variables (design tokens) for one-place tweaks.
// ---------------------------------------------------------------------------

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const fmtDate = (ms) =>
  ms ? new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";

export const fmtLongDate = (d = new Date()) =>
  d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

// Multiline plain text -> paragraphs.
export const paragraphs = (text) =>
  esc(text)
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");

const CSS = `
:root{
  --paper:#FAF7F0; --ink:#171512; --muted:#6f6a5f; --rule:#171512; --rule-soft:#e2dccf;
  --accent:#A6873C; --danger:#C24333;
  --serif:"Playfair Display",Georgia,serif; --mono:"IBM Plex Mono","Courier New",monospace;
}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--paper);color:var(--ink);font-family:var(--serif);min-height:100vh;display:flex;flex-direction:column}
.wrap{max-width:1280px;margin:0 auto;padding:0 32px;width:100%}
main.wrap{flex:1}
a{color:inherit}
.mono{font-family:var(--mono)}
.kicker{font-family:var(--mono);font-size:11px;letter-spacing:.3em;text-transform:uppercase;color:var(--accent)}
.topbar{display:flex;justify-content:space-between;align-items:center;padding:14px 0;border-bottom:1px solid var(--rule-soft)}
.topbar .date{font-family:var(--mono);font-size:11px;letter-spacing:.25em;text-transform:uppercase}
.chips{display:flex;gap:10px;flex-wrap:wrap}
.chip{font-family:var(--mono);font-size:10px;letter-spacing:.2em;text-transform:uppercase;border:1px solid var(--ink);padding:5px 12px;text-decoration:none;color:var(--ink);background:transparent;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.chip:hover{background:var(--ink);color:var(--paper)}
.chip.gold{border-color:var(--accent);color:var(--accent)}
.chip.gold:hover{background:var(--accent);color:var(--paper)}
.masthead{text-align:center;padding:44px 0 30px}
.masthead h1{font-weight:500;font-size:clamp(34px,6vw,64px);letter-spacing:-.01em}
.masthead h1 a{text-decoration:none}
.masthead .tagline{font-family:var(--mono);font-size:11px;letter-spacing:.35em;text-transform:uppercase;color:var(--muted);margin-top:14px}
nav{border-top:1px solid var(--rule-soft);border-bottom:1px solid var(--rule-soft)}
nav ul{display:flex;justify-content:center;gap:48px;list-style:none;padding:16px 0;flex-wrap:wrap}
nav a{font-family:var(--mono);font-size:12px;letter-spacing:.22em;text-transform:uppercase;text-decoration:none}
nav a:hover,nav a.active{border-bottom:2px solid var(--accent);padding-bottom:4px}
.section-head{display:flex;align-items:flex-start;gap:14px;padding:56px 0 8px}
.section-head .icon{color:var(--accent);font-size:20px;margin-top:2px}
.section-head h2{font-weight:400;font-size:26px;margin-top:6px}
.tabs{display:flex;gap:36px;border-bottom:1px solid var(--rule-soft);margin-top:28px;flex-wrap:wrap}
.tab{font-family:var(--mono);font-size:12px;letter-spacing:.2em;text-transform:uppercase;padding:12px 2px;text-decoration:none;color:var(--muted)}
.tab.active{color:var(--ink);border-bottom:2px solid var(--ink)}
.list-meta{display:flex;justify-content:space-between;align-items:center;padding:34px 0 10px;gap:16px;flex-wrap:wrap}
.count{font-family:var(--mono);font-size:11px;letter-spacing:.25em;text-transform:uppercase;color:var(--muted)}
.btn{font-family:var(--mono);font-size:11px;letter-spacing:.2em;text-transform:uppercase;background:var(--ink);color:var(--paper);border:0;padding:14px 22px;cursor:pointer;text-decoration:none;display:inline-block}
.btn:hover{background:var(--accent)}
.btn.line{background:transparent;color:var(--ink);border:1px solid var(--ink)}
.btn.line:hover{background:var(--ink);color:var(--paper)}
.row{display:flex;justify-content:space-between;align-items:center;padding:26px 0;border-bottom:1px solid var(--rule-soft);gap:18px}
.cat{font-family:var(--mono);font-size:10px;letter-spacing:.28em;text-transform:uppercase;color:var(--accent)}
.row h3{font-weight:500;font-size:24px;text-transform:uppercase;letter-spacing:.01em;margin:6px 0}
.row h3 a{text-decoration:none}
.row h3 a:hover{color:var(--accent)}
.meta{font-family:var(--mono);font-size:11px;letter-spacing:.12em;color:var(--muted);display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.actions{display:flex;gap:14px;flex-shrink:0}
.iconbtn{background:none;border:0;cursor:pointer;font-size:15px;color:var(--muted);text-decoration:none}
.iconbtn:hover{color:var(--ink)}
.iconbtn.del{color:var(--danger)}
.badge{font-family:var(--mono);font-size:9px;letter-spacing:.2em;padding:3px 8px;border:1px solid var(--accent);color:var(--accent);text-transform:uppercase;margin-left:8px}
.badge.vip{background:var(--ink);border-color:var(--ink);color:var(--accent)}
.hero{padding:56px 0 34px;border-bottom:1px solid var(--rule-soft)}
.hero h2{font-weight:600;font-size:clamp(28px,4.5vw,46px);text-transform:uppercase;margin:12px 0}
.hero h2 a{text-decoration:none}
.hero h2 a:hover{color:var(--accent)}
.hero .standfirst{font-size:19px;font-style:italic;color:var(--muted);max-width:820px}
article.body{max-width:820px;margin:0 auto;padding:40px 0 20px;font-size:19px;line-height:1.75}
article.body p{margin:0 0 22px}
.art-head{max-width:820px;margin:0 auto;padding-top:52px;text-align:center}
.art-head h2{font-weight:600;font-size:clamp(26px,4vw,42px);text-transform:uppercase;margin:14px 0}
.art-head .meta{justify-content:center}
.rule-heavy{border:0;border-top:2px solid var(--rule);margin:26px auto;max-width:820px}
form.sheet{max-width:460px;margin:0 auto;padding:46px 0}
form.sheet label,.field label{display:block;font-family:var(--mono);font-size:10px;letter-spacing:.25em;text-transform:uppercase;color:var(--muted);margin:22px 0 8px}
form.sheet input,form.sheet textarea,form.sheet select,form.wide input,form.wide textarea,form.wide select{width:100%;background:transparent;border:1px solid var(--rule-soft);padding:13px 14px;font-family:var(--mono);font-size:14px;color:var(--ink)}
form.sheet input:focus,form.sheet textarea:focus,form.wide input:focus,form.wide textarea:focus,form.wide select:focus{outline:none;border-color:var(--accent)}
form.sheet .btn,form.wide .btn{margin-top:28px;width:100%}
.notice{font-family:var(--mono);font-size:12px;letter-spacing:.06em;border:1px solid var(--accent);color:var(--accent);padding:14px 16px;margin:26px auto;max-width:820px}
.notice.err{border-color:var(--danger);color:var(--danger)}
.paybox{max-width:640px;margin:34px auto;border:1px solid var(--rule);padding:34px}
.paybox code{display:block;font-family:var(--mono);font-size:13px;background:var(--ink);color:var(--paper);padding:16px;margin:16px 0;word-break:break-all;cursor:pointer}
.tiers{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:26px;padding:40px 0}
.tier{border:1px solid var(--rule);padding:34px;text-align:center}
.tier.vip{background:var(--ink);color:var(--paper)}
.tier .price{font-size:44px;font-weight:600;margin:16px 0 4px}
.tier ul{list-style:none;font-family:var(--mono);font-size:12px;letter-spacing:.06em;color:var(--muted);margin:18px 0 26px;line-height:2.1}
.tier.vip ul{color:#b8b2a4}
.lockbox{max-width:820px;margin:20px auto 40px;border:1px solid var(--accent);padding:40px;text-align:center}
table.grid{width:100%;border-collapse:collapse;margin:20px 0}
table.grid th{font-family:var(--mono);font-size:10px;letter-spacing:.25em;text-transform:uppercase;color:var(--muted);text-align:left;padding:12px 10px;border-bottom:1px solid var(--rule)}
table.grid td{padding:14px 10px;border-bottom:1px solid var(--rule-soft);font-size:15px;vertical-align:middle}
table.grid td .mono,table.grid td select{font-family:var(--mono);font-size:12px}
footer{margin-top:70px;border-top:1px solid var(--rule);padding:26px 0 60px;text-align:center}
footer p{font-family:var(--mono);font-size:10px;letter-spacing:.25em;text-transform:uppercase;color:var(--muted);line-height:2.2}
footer a{color:var(--muted)}
@media(max-width:640px){nav ul{gap:22px}.row{flex-direction:column;align-items:flex-start}.wrap{padding:0 18px}}
`;

const NAV = [
  ["/", "Home"],
  ["/daily-report", "Daily Report"],
  ["/news-stories", "News Stories"],
  ["/announcements", "Announcements"],
  ["/premium", "Premium"],
  ["/search", "Search"],
];

export function page({ title, user, active = "", body, isAdmin = false }) {
  const chips = user
    ? `${isAdmin ? `<a class="chip" href="/admin">◎ Admin</a>` : ""}
       <a class="chip gold" href="/account">☰ ${esc(user.username)}</a>
       <a class="chip" href="/logout">⇥ Log out</a>`
    : `<a class="chip" href="/login">Log in</a><a class="chip gold" href="/register">Register</a>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)} — Redmont's Economic News</title>
<meta name="description" content="The official digital broadsheet of DemocracyCraft — economic intelligence, government policy updates, and exclusive legislative insights.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>
  <div class="wrap">
    <div class="topbar">
      <span class="date">${fmtLongDate()}</span>
      <div class="chips">${chips}</div>
    </div>
    <header class="masthead">
      <h1><a href="/">Redmont&rsquo;s Economic News</a></h1>
      <div class="tagline">Your news channel for the economy &nbsp;&middot;&nbsp; est. 2026</div>
    </header>
    <nav><ul>${NAV.map(([href, label]) => `<li><a href="${href}"${active === href ? ' class="active"' : ""}>${label}</a></li>`).join("")}</ul></nav>
  </div>
  <main class="wrap">
${body}
  </main>
  <div class="wrap">
    <footer>
      <p>Redmont&rsquo;s Economic News · The official digital broadsheet of DemocracyCraft</p>
      <p><a href="/contact">Contact the desk</a></p>
    </footer>
  </div>
</body>
</html>`;
}

export function articleRow(a, { adminLinks = false } = {}) {
  const badge = a.tier === 1 ? `<span class="badge">Premium</span>` : a.tier === 2 ? `<span class="badge vip">VIP</span>` : "";
  const draft = adminLinks && !a.published ? `<span class="badge" style="border-color:var(--danger);color:var(--danger)">Draft</span>` : "";
  const actions = adminLinks
    ? `<div class="actions">
         <a class="iconbtn" title="Edit" href="/admin/articles/${a.id}/edit">✎</a>
         <form method="POST" action="/admin/articles/${a.id}/delete" style="display:inline" onsubmit="return confirm('Delete this article?')">
           <button class="iconbtn del" title="Delete">🗑</button>
         </form>
       </div>`
    : "";
  return `<div class="row">
    <div>
      <div class="cat">${esc(a.category)}${badge}${draft}</div>
      <h3><a href="/article/${a.id}">${esc(a.title)}</a></h3>
      <div class="meta"><span>${esc(a.author)}</span> · <span>${fmtDate(a.published_at || a.created_at)}</span> · <span>👁 ${a.views}</span></div>
    </div>
    ${actions}
  </div>`;
}

export function sectionHead(kicker, heading, icon = "▤") {
  return `<div class="section-head"><span class="icon">${icon}</span><div><div class="kicker">${esc(kicker)}</div><h2>${esc(heading)}</h2></div></div>`;
}

export const notice = (text, err = false) => `<div class="notice${err ? " err" : ""}">${esc(text)}</div>`;
