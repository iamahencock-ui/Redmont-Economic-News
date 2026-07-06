// ---------------------------------------------------------------------------
// Redmont's Economic News — Cloudflare Worker + D1.
// Public broadsheet + accounts + treasury-paid Premium/VIP + admin panel.
// ---------------------------------------------------------------------------
import {
  hashPassword, verifyPassword, randomToken,
  createSession, destroySession, readSessionToken, getSessionUser,
  sessionSetCookie, sessionClearCookie, effectiveRole, canReadTier, isAdmin, isWriter,
} from "./auth.js";
import {
  resolveFirm, recentTransactions, sumForMemo,
  listWebhooks, createWebhook, deleteWebhook, verifyPush,
} from "./treasury.js";
import { page, esc, fmtDate, paragraphs, articleRow, sectionHead, notice } from "./ui.js";

// === Client-tunable settings ================================================
// TODO: confirm prices/duration with the client before launch.
const PRICES = { premium: 25, vip: 60 }; // DC dollars
const TIER_DAYS = 30;                    // subscription length in days
const MEMO_PREFIX = "REN";
// ============================================================================

const html = (body, status = 200, headers = {}) =>
  new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", ...headers } });
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
const redirect = (loc, headers = {}) => new Response(null, { status: 303, headers: { Location: loc, ...headers } });
const now = () => Date.now();

async function cfg(db, key) {
  const r = await db.prepare("SELECT value FROM config WHERE key = ?").bind(key).first();
  return r ? r.value : null;
}
async function setCfg(db, key, value) {
  await db.prepare("INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, value).run();
}

export default {
  async fetch(request, env, ctx) {
    const db = env.DB;
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method;

    try {
      const user = await getSessionUser(db, request);
      const P = (t, act, body) => html(page({ title: t, user, active: act, body, isAdmin: isWriter(user) }));

      
      // ---- public pages ----
      if (method === "GET") {
        if (path === "/") return P("Home", "/", await homePage(db, user));
        if (path === "/news-stories") return P("News Stories", "/news-stories", await storiesPage(db));
        if (path === "/announcements") return P("Announcements", "/announcements", await announcementsPage(db));
        if (path === "/daily-report") return P("Daily Report", "/daily-report", await dailyReportPage(db, url));
        if (path === "/search") return P("Search", "/search", await searchPage(db, url));
        if (path.match(/^\/article\/\d+$/)) {
          const out = await articlePage(db, user, Number(path.split("/")[2]));
          return out ? P(out.title, "/news-stories", out.body) : html(page({ title: "Not found", user, body: notice("Article not found.", true) }), 404);
        }
        if (path === "/premium") return P("Premium", "/premium", await premiumPage(db, env, user, url));
        if (path === "/contact") return P("Contact", "", contactPage(url));
        if (path === "/login") return P("Log in", "", authForm("login", url));
        if (path === "/register") return P("Register", "", authForm("register", url));
        if (path === "/forgot-password") return P("Forgot password", "", forgotPage());
        if (path === "/reset-password") return P("Reset password", "", resetPage(url));
        if (path === "/account") {
          if (!user) return redirect("/login");
          return P("Account", "", accountPage(db, user, await latestOrder(db, user.id)));
        }
        if (path === "/logout") {
          await destroySession(db, readSessionToken(request));
          return redirect("/", { "Set-Cookie": sessionClearCookie() });
        }
        if (path === "/api/upgrade/status") {
          if (!user) return json({ error: "AUTH" }, 401);
          const o = await latestOrder(db, user.id);
          return json({ status: o?.status ?? "none" });
        }
      }

      // ---- public POSTs ----
      if (method === "POST") {
        if (path === "/register") return doRegister(db, request);
        if (path === "/login") return doLogin(db, request);
        if (path === "/reset-password") return doReset(db, request);
        if (path === "/contact") return doContact(db, request);
        if (path === "/upgrade/start") {
          if (!user) return redirect("/login?next=/premium");
          return doStartUpgrade(db, request, user);
        }
        if (path === "/upgrade/verify") {
          if (!user) return redirect("/login");
          await processPendingOrders(db, env);
          return redirect("/premium?checked=1");
        }
        if (path === "/webhook/treasury") return handleWebhook(db, env, request, ctx);
      }

      // ---- admin (writers get the content tabs; admins get everything) ----
      if (path === "/admin" || path.startsWith("/admin/")) {
        if (!user || !isWriter(user)) return redirect("/login?next=/admin");
        const out = await adminRouter(db, env, request, url, path, method, user);
        if (out) return out;
      }

      return html(page({ title: "Not found", user, body: notice("Page not found.", true) }), 404);
    } catch (e) {
      console.error("fatal:", e.stack || e.message);
      return html(page({ title: "Error", user: null, body: notice("Something went wrong. Try again shortly.", true) }), 500);
    }
  },
};

// === Public pages =============================================================

async function homePage(db, user) {
  const { results: latest } = await db
    .prepare("SELECT * FROM articles WHERE published = 1 ORDER BY COALESCE(published_at, created_at) DESC LIMIT 8")
    .bind()
    .all();
  const [hero, ...rest] = latest;
  const heroHtml = hero
    ? `<div class="hero">
        <div class="cat">${esc(hero.category)}${hero.tier === 1 ? '<span class="badge">Premium</span>' : hero.tier === 2 ? '<span class="badge vip">VIP</span>' : ""}</div>
        <h2><a href="/article/${hero.id}">${esc(hero.title)}</a></h2>
        <div class="standfirst">${esc(hero.body.slice(0, 220))}${hero.body.length > 220 ? "…" : ""}</div>
        <div class="meta" style="margin-top:16px"><span>${esc(hero.author)}</span> · <span>${fmtDate(hero.published_at || hero.created_at)}</span> · <span>👁 ${hero.views}</span></div>
      </div>`
    : notice("No articles yet — the presses are warming up.");
  const ann = await db.prepare("SELECT * FROM announcements ORDER BY created_at DESC LIMIT 1").first();
  const annHtml = ann
    ? `<div class="notice">📢 <strong>${esc(ann.title)}</strong> — ${esc(ann.body.slice(0, 160))} <a href="/announcements">more</a></div>`
    : "";
  return `${annHtml}${heroHtml}${sectionHead("Latest", "Recent stories")}${rest.map((a) => articleRow(a)).join("") || ""}`;
}

async function storiesPage(db) {
  const { results } = await db
    .prepare("SELECT * FROM articles WHERE published = 1 ORDER BY COALESCE(published_at, created_at) DESC LIMIT 100")
    .all();
  return `${sectionHead("Archive", "All news stories")}
    <div class="list-meta"><span class="count">${results.length} article${results.length === 1 ? "" : "s"} on record</span></div>
    ${results.map((a) => articleRow(a)).join("") || notice("Nothing published yet.")}`;
}

async function announcementsPage(db) {
  const { results } = await db.prepare("SELECT * FROM announcements ORDER BY created_at DESC LIMIT 50").all();
  return `${sectionHead("Bulletin", "Announcements", "📢")}
    ${results
      .map(
        (a) => `<div class="row"><div>
          <div class="cat">${fmtDate(a.created_at)}</div>
          <h3>${esc(a.title)}</h3>
          <div style="max-width:820px;font-size:17px;line-height:1.6;margin-top:8px">${paragraphs(a.body)}</div>
        </div></div>`
      )
      .join("") || notice("No announcements yet.")}`;
}

async function dailyReportPage(db, url) {
  const id = url.searchParams.get("id");
  const report = id
    ? await db.prepare("SELECT * FROM daily_reports WHERE id = ?").bind(Number(id)).first()
    : await db.prepare("SELECT * FROM daily_reports ORDER BY report_date DESC, id DESC LIMIT 1").first();
  const { results: archive } = await db
    .prepare("SELECT id, report_date, title FROM daily_reports ORDER BY report_date DESC, id DESC LIMIT 30")
    .all();
  const body = report
    ? `<div class="art-head"><div class="kicker">Daily Report · ${esc(report.report_date)}</div><h2>${esc(report.title)}</h2></div>
       <hr class="rule-heavy"><article class="body">${paragraphs(report.body)}</article>`
    : notice("No daily reports filed yet.");
  const archiveHtml = archive.length > 1
    ? `${sectionHead("Archive", "Past reports", "🗞")}${archive
        .map((r) => `<div class="row"><div><div class="cat">${esc(r.report_date)}</div><h3><a href="/daily-report?id=${r.id}">${esc(r.title)}</a></h3></div></div>`)
        .join("")}`
    : "";
  return body + archiveHtml;
}

async function searchPage(db, url) {
  const q = (url.searchParams.get("q") || "").trim();
  let resultsHtml = "";
  if (q) {
    const like = `%${q.replace(/[%_]/g, "")}%`;
    const { results } = await db
      .prepare("SELECT * FROM articles WHERE published = 1 AND (title LIKE ? OR body LIKE ? OR category LIKE ?) ORDER BY COALESCE(published_at, created_at) DESC LIMIT 50")
      .bind(like, like, like)
      .all();
    resultsHtml = `<div class="list-meta"><span class="count">${results.length} result${results.length === 1 ? "" : "s"} for “${esc(q)}”</span></div>
      ${results.map((a) => articleRow(a)).join("") || notice("No matches.")}`;
  }
  return `${sectionHead("Search", "Search the archive", "🔍")}
    <form class="wide" method="GET" action="/search" style="max-width:640px;margin:26px 0;display:flex;gap:12px">
      <input name="q" value="${esc(q)}" placeholder="Titles, categories, article text…" style="flex:1">
      <button class="btn">Search</button>
    </form>${resultsHtml}`;
}

async function articlePage(db, user, id) {
  const a = await db.prepare("SELECT * FROM articles WHERE id = ? AND published = 1").bind(id).first();
  if (!a) return null;
  await db.prepare("UPDATE articles SET views = views + 1 WHERE id = ?").bind(id).run();

  const head = `<div class="art-head">
    <div class="cat">${esc(a.category)}${a.tier === 1 ? '<span class="badge">Premium</span>' : a.tier === 2 ? '<span class="badge vip">VIP</span>' : ""}</div>
    <h2>${esc(a.title)}</h2>
    <div class="meta"><span>${esc(a.author)}</span> · <span>${fmtDate(a.published_at || a.created_at)}</span> · <span>👁 ${a.views + 1}</span></div>
  </div><hr class="rule-heavy">`;

  if (!canReadTier(user, a.tier)) {
    const tierName = a.tier === 2 ? "VIP" : "Premium";
    const teaser = esc(a.body.slice(0, 260)) + "…";
    return {
      title: a.title,
      body: `${head}<article class="body"><p>${teaser}</p></article>
        <div class="lockbox">
          <div class="kicker">🔒 ${tierName} story</div>
          <h2 style="font-weight:500;margin:14px 0 20px">The rest of this story is for ${tierName} subscribers.</h2>
          <a class="btn" href="/premium">Unlock with ${tierName}</a>
          ${user ? "" : `<p class="meta" style="justify-content:center;margin-top:16px">Already subscribed? <a href="/login">Log in</a></p>`}
        </div>`,
    };
  }
  return { title: a.title, body: `${head}<article class="body">${paragraphs(a.body)}</article>` };
}

// === Auth pages ===============================================================

function authForm(kind, url) {
  const err = url.searchParams.get("err");
  const next = esc(url.searchParams.get("next") || "/");
  const msgs = {
    taken: "That username or email is already registered.",
    bad: "Wrong username/email or password.",
    short: "Password must be at least 8 characters.",
    missing: "Fill in every field.",
  };
  const errHtml = err && msgs[err] ? notice(msgs[err], true) : "";
  if (kind === "register") {
    return `${sectionHead("Accounts", "Create your account", "👤")}${errHtml}
      <form class="sheet" method="POST" action="/register">
        <input type="hidden" name="next" value="${next}">
        <label>Username</label><input name="username" required maxlength="24" pattern="[A-Za-z0-9_ ]{3,24}">
        <label>Email</label><input name="email" type="email" required maxlength="120">
        <label>Password</label><input name="password" type="password" required minlength="8">
        <button class="btn">Register</button>
        <p class="meta" style="margin-top:18px">Already registered? <a href="/login">Log in</a></p>
      </form>`;
  }
  return `${sectionHead("Accounts", "Log in", "👤")}${errHtml}
    <form class="sheet" method="POST" action="/login">
      <input type="hidden" name="next" value="${next}">
      <label>Username or email</label><input name="id" required>
      <label>Password</label><input name="password" type="password" required>
      <button class="btn">Log in</button>
      <p class="meta" style="margin-top:18px"><a href="/forgot-password">Forgot password?</a> · <a href="/register">Register</a></p>
    </form>`;
}

async function doRegister(db, request) {
  const f = await request.formData();
  const username = (f.get("username") || "").trim();
  const email = (f.get("email") || "").trim().toLowerCase();
  const password = f.get("password") || "";
  const next = f.get("next") || "/";
  if (!username || !email || !password) return redirect("/register?err=missing");
  if (password.length < 8) return redirect("/register?err=short");

  const exists = await db.prepare("SELECT id FROM users WHERE username = ? OR email = ?").bind(username, email).first();
  if (exists) return redirect("/register?err=taken");

  // First account on the site becomes admin staff (separate from subscription tier).
  const count = await db.prepare("SELECT COUNT(*) AS n FROM users").first();
  const isFirst = count.n === 0 ? 2 : 0;

  const salt = randomToken(16);
  const hash = await hashPassword(password, salt);
  const r = await db
    .prepare("INSERT INTO users (username, email, pass_hash, salt, role, is_admin, created_at) VALUES (?, ?, ?, ?, 'reader', ?, ?)")
    .bind(username, email, hash, salt, isFirst, now())
    .run();
  const { token } = await createSession(db, r.meta.last_row_id);
  return redirect(next, { "Set-Cookie": sessionSetCookie(token) });
}

async function doLogin(db, request) {
  const f = await request.formData();
  const id = (f.get("id") || "").trim();
  const password = f.get("password") || "";
  const next = f.get("next") || "/";
  const u = await db.prepare("SELECT * FROM users WHERE username = ? OR email = ?").bind(id, id.toLowerCase()).first();
  if (!u || !(await verifyPassword(password, u.salt, u.pass_hash))) {
    return redirect(`/login?err=bad&next=${encodeURIComponent(next)}`);
  }
  const { token } = await createSession(db, u.id);
  return redirect(next, { "Set-Cookie": sessionSetCookie(token) });
}

function forgotPage() {
  return `${sectionHead("Accounts", "Forgot your password?", "🔑")}
    <div class="paybox">
      <p style="font-size:17px;line-height:1.7">Password resets are handled by the editorial desk. Message the staff
      on Discord (or in-game) and they'll issue you a one-time reset link from the admin panel.</p>
      <p class="meta" style="margin-top:16px"><a href="/contact">Contact the desk</a></p>
    </div>`;
}

function resetPage(url) {
  const token = esc(url.searchParams.get("token") || "");
  const err = url.searchParams.get("err");
  if (!token) return notice("This reset link is missing its token.", true);
  return `${sectionHead("Accounts", "Set a new password", "🔑")}
    ${err ? notice(err === "used" ? "This link was already used or expired." : "Password must be at least 8 characters.", true) : ""}
    <form class="sheet" method="POST" action="/reset-password">
      <input type="hidden" name="token" value="${token}">
      <label>New password</label><input name="password" type="password" required minlength="8">
      <button class="btn">Save password</button>
    </form>`;
}

async function doReset(db, request) {
  const f = await request.formData();
  const token = f.get("token") || "";
  const password = f.get("password") || "";
  if (password.length < 8) return redirect(`/reset-password?token=${encodeURIComponent(token)}&err=short`);
  const t = await db.prepare("SELECT * FROM reset_tokens WHERE token = ? AND used = 0 AND expires_at > ?").bind(token, now()).first();
  if (!t) return redirect(`/reset-password?token=${encodeURIComponent(token)}&err=used`);
  const salt = randomToken(16);
  const hash = await hashPassword(password, salt);
  await db.prepare("UPDATE users SET pass_hash = ?, salt = ? WHERE id = ?").bind(hash, salt, t.user_id).run();
  await db.prepare("UPDATE reset_tokens SET used = 1 WHERE token = ?").bind(token).run();
  await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(t.user_id).run();
  return redirect("/login");
}

function contactPage(url) {
  const sent = url.searchParams.get("sent");
  return `${sectionHead("Contact", "Write to the desk", "✉")}
    ${sent ? notice("Message received — the desk will get back to you.") : ""}
    <form class="sheet" method="POST" action="/contact">
      <label>Your name</label><input name="name" required maxlength="60">
      <label>How to reach you (Discord / IGN)</label><input name="contact" maxlength="120">
      <label>Message</label><textarea name="body" rows="6" required maxlength="4000"></textarea>
      <button class="btn">Send</button>
    </form>`;
}

async function doContact(db, request) {
  const f = await request.formData();
  const name = (f.get("name") || "").trim();
  const body = (f.get("body") || "").trim();
  if (name && body) {
    await db.prepare("INSERT INTO messages (name, contact, body, created_at) VALUES (?, ?, ?, ?)")
      .bind(name, (f.get("contact") || "").trim(), body, now()).run();
  }
  return redirect("/contact?sent=1");
}

function accountPage(db, user, order) {
  const role = effectiveRole(user);
  const exp = user.tier_expires_at
    ? user.tier_expires_at < now() ? " (expired)" : ` — renews/expires ${fmtDate(user.tier_expires_at)}`
    : "";
  const staffBox = Number(user.is_admin) >= 1
    ? `<div class="paybox"><div class="kicker">Staff</div>
       <h2 style="font-weight:500;margin:12px 0">${Number(user.is_admin) >= 2 ? "Editorial staff (admin)" : "Writer"} — <a href="/admin">${Number(user.is_admin) >= 2 ? "admin panel" : "writer's desk"}</a></h2>
       <p class="meta">Staff access is separate from your subscription.</p></div>`
    : "";
  return `${sectionHead("Accounts", `Signed in as ${user.username}`, "👤")}
    <div class="paybox">
      <div class="kicker">Subscription</div>
      <h2 style="font-weight:500;margin:12px 0">${role.charAt(0).toUpperCase() + role.slice(1)}${role === "reader" ? "" : esc(exp)}</h2>
      ${role === "reader" ? `<a class="btn" href="/premium">Upgrade</a>` : ""}
      ${order && order.status === "pending" ? `<p class="meta" style="margin-top:14px">You have a pending ${esc(order.tier)} order — <a href="/premium">finish payment</a>.</p>` : ""}
    </div>${staffBox}`;
}

// === Premium / paywall ========================================================

async function latestOrder(db, userId) {
  return db.prepare("SELECT * FROM upgrade_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 1").bind(userId).first();
}

async function premiumPage(db, env, user, url) {
  const checked = url.searchParams.get("checked");
  const tiers = `
    <div class="tiers">
      <div class="tier">
        <div class="kicker">Tier one</div>
        <h2 style="font-weight:500;margin-top:10px">Premium</h2>
        <div class="price">$${PRICES.premium}</div>
        <div class="meta" style="justify-content:center">per ${TIER_DAYS} days</div>
        <ul><li>All Premium stories</li><li>Full daily reports</li><li>Support the paper</li></ul>
        <form method="POST" action="/upgrade/start"><input type="hidden" name="tier" value="premium"><button class="btn line">Get Premium</button></form>
      </div>
      <div class="tier vip">
        <div class="kicker">Tier two</div>
        <h2 style="font-weight:500;margin-top:10px">VIP</h2>
        <div class="price">$${PRICES.vip}</div>
        <div class="meta" style="justify-content:center">per ${TIER_DAYS} days</div>
        <ul><li>Everything in Premium</li><li>VIP-only insider stories</li><li>First look at legislation</li></ul>
        <form method="POST" action="/upgrade/start"><input type="hidden" name="tier" value="vip"><button class="btn" style="background:var(--accent)">Get VIP</button></form>
      </div>
    </div>`;

  if (!user) {
    return `${sectionHead("Subscriptions", "Premium & VIP access", "★")}${tiers}
      ${notice("Log in or register first — your subscription attaches to your account.")}
      <p style="text-align:center;margin:10px 0 40px"><a class="btn line" href="/login?next=/premium">Log in</a> &nbsp; <a class="btn" href="/register?next=/premium">Register</a></p>`;
  }

  const role = effectiveRole(user);
  const order = await latestOrder(db, user.id);

  let payBox = "";
  if (order && order.status === "pending") {
    const firm = await resolveFirm(env);
    const firmName = firm?.firmName ?? "<firm>";
    payBox = `<div class="paybox" id="paybox">
      <div class="kicker">Finish your ${esc(order.tier)} order</div>
      <p style="margin:14px 0;font-size:17px;line-height:1.7">Run this in-game (tap to copy), then payment is detected <strong>automatically within seconds</strong>:</p>
      <code onclick="navigator.clipboard.writeText(this.textContent)">/pay-account business ${esc(firmName)} ${order.price} ${esc(order.memo)}</code>
      <div class="meta">Memo <strong>${esc(order.memo)}</strong> is unique to this order — keep it exact.</div>
      <form method="POST" action="/upgrade/verify" style="margin-top:20px"><button class="btn line">I've paid — check now</button></form>
      ${checked ? notice("Checked the ledger — no matching payment yet. Payments can take a few seconds to settle; try again shortly.", true) : ""}
    </div>
    <script>
      (function poll(){setTimeout(async()=>{try{const r=await fetch('/api/upgrade/status');const j=await r.json();
        if(j.status==='paid'){location.href='/premium';return}}catch(e){}poll()},5000)})();
    </script>`;
  } else if (role === "premium" || role === "vip") {
    payBox = notice(`You're subscribed: ${role.toUpperCase()}${user.tier_expires_at ? ` until ${fmtDate(user.tier_expires_at)}` : ""}. 🎉`);
  }

  return `${sectionHead("Subscriptions", "Premium & VIP access", "★")}${payBox}${tiers}`;
}

async function doStartUpgrade(db, request, user) {
  const f = await request.formData();
  const tier = f.get("tier");
  if (!PRICES[tier]) return redirect("/premium");
  // Reuse an existing pending order for the same tier; replace otherwise.
  const existing = await latestOrder(db, user.id);
  if (existing && existing.status === "pending" && existing.tier === tier) return redirect("/premium");
  if (existing && existing.status === "pending") {
    await db.prepare("DELETE FROM upgrade_orders WHERE id = ?").bind(existing.id).run();
  }
  const memo = MEMO_PREFIX + randomToken(8).toUpperCase().slice(0, 12);
  await db.prepare("INSERT INTO upgrade_orders (user_id, tier, memo, price, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(user.id, tier, memo, PRICES[tier], now()).run();
  return redirect("/premium");
}

// The single source of truth for unlocking: read the firm ledger, match memos
// of pending orders, upgrade accounts. Called by webhook pushes and the
// "check now" button — never trusts request bodies.
async function processPendingOrders(db, env) {
  const { results: pending } = await db
    .prepare("SELECT * FROM upgrade_orders WHERE status = 'pending' AND created_at > ?")
    .bind(now() - 7 * 86_400_000)
    .all();
  if (!pending.length) return 0;
  const r = await recentTransactions(env, 100);
  if (!r.ok) return 0;

  let upgraded = 0;
  for (const o of pending) {
    const { total, txnId } = sumForMemo(r.items, o.memo);
    if (total + 1e-9 < o.price) continue;
    const u = await db.prepare("SELECT * FROM users WHERE id = ?").bind(o.user_id).first();
    if (!u) continue;
    // Extend from current expiry if still active on the same-or-lower tier.
    const base = u.tier_expires_at && u.tier_expires_at > now() ? u.tier_expires_at : now();
    const newExpiry = base + TIER_DAYS * 86_400_000;
    await db.prepare("UPDATE users SET role = ?, tier_expires_at = ? WHERE id = ?").bind(o.tier, newExpiry, u.id).run();
    await db.prepare("UPDATE upgrade_orders SET status = 'paid', txn_id = ?, paid_at = ? WHERE id = ?").bind(txnId, now(), o.id).run();
    upgraded++;
  }
  return upgraded;
}

async function handleWebhook(db, env, request, ctx) {
  const raw = await request.text();
  const secret = await cfg(db, "webhook_secret");
  const ok = await verifyPush(request, raw, secret);
  if (ok) {
    ctx.waitUntil(processPendingOrders(db, env));
    return new Response(null, { status: 204 });
  }
  // Unknown signature scheme: don't trust it, but a ledger re-read is harmless.
  // Rate-limit via config timestamp (Workers have no shared memory).
  const last = Number((await cfg(db, "last_unverified_scan")) || 0);
  if (now() - last > 30_000) {
    await setCfg(db, "last_unverified_scan", String(now()));
    console.warn("webhook: unverified push — running rate-limited scan");
    ctx.waitUntil(processPendingOrders(db, env));
  }
  return new Response("unverified", { status: 401 });
}

// === Admin ====================================================================

async function adminRouter(db, env, request, url, path, method, user) {
  const admin = isAdmin(user); // writers (level 1) get content tabs only
  const P = (body, tab) =>
    html(page({ title: "Admin", user, body: adminShell(tab, body, admin), isAdmin: true }));

  if (method === "GET") {
    if (path === "/admin") {
      const tab = url.searchParams.get("tab") || "articles";
      if (tab === "articles") return P(await adminArticles(db), "articles");
      if (tab === "reports") return P(await adminReports(db), "reports");
      if (tab === "announcements") return P(await adminAnnouncements(db), "announcements");
      if (!admin) return redirect("/admin");
      if (tab === "accounts") return P(await adminAccounts(db, url), "accounts");
      if (tab === "messages") return P(await adminMessages(db), "messages");
      if (tab === "settings") return P(await adminSettings(db, env, url), "settings");
    }
    if (path === "/admin/articles/new") return P(articleForm(), "articles");
    const editMatch = path.match(/^\/admin\/articles\/(\d+)\/edit$/);
    if (editMatch) {
      const a = await db.prepare("SELECT * FROM articles WHERE id = ?").bind(Number(editMatch[1])).first();
      return a ? P(articleForm(a), "articles") : redirect("/admin");
    }
  }

  if (method === "POST") {
    const f = await request.formData();
    // Writers may only hit content routes; accounts/messages/settings are admin-only.
    if (!admin && !/^\/admin\/(articles|reports|announcements)(\/|$)/.test(path)) return redirect("/admin");
    if (path === "/admin/articles/save") {
      const id = Number(f.get("id") || 0);
      const vals = {
        title: (f.get("title") || "").trim(),
        category: (f.get("category") || "Economy").trim(),
        author: (f.get("author") || user.username).trim(),
        body: (f.get("body") || "").trim(),
        tier: Math.min(2, Math.max(0, Number(f.get("tier") || 0))),
        published: f.get("published") ? 1 : 0,
      };
      if (!vals.title || !vals.body) return redirect(id ? `/admin/articles/${id}/edit` : "/admin/articles/new");
      if (id) {
        const prev = await db.prepare("SELECT published, published_at FROM articles WHERE id = ?").bind(id).first();
        const publishedAt = prev?.published_at ?? (vals.published ? now() : null);
        await db.prepare("UPDATE articles SET title=?, category=?, author=?, body=?, tier=?, published=?, published_at=? WHERE id=?")
          .bind(vals.title, vals.category, vals.author, vals.body, vals.tier, vals.published, vals.published ? (publishedAt ?? now()) : publishedAt, id).run();
      } else {
        await db.prepare("INSERT INTO articles (title, category, author, body, tier, published, published_at, created_at) VALUES (?,?,?,?,?,?,?,?)")
          .bind(vals.title, vals.category, vals.author, vals.body, vals.tier, vals.published, vals.published ? now() : null, now()).run();
      }
      return redirect("/admin");
    }
    let m;
    if ((m = path.match(/^\/admin\/articles\/(\d+)\/delete$/))) {
      await db.prepare("DELETE FROM articles WHERE id = ?").bind(Number(m[1])).run();
      return redirect("/admin");
    }
    if (path === "/admin/reports/save") {
      await db.prepare("INSERT INTO daily_reports (report_date, title, body, created_at) VALUES (?,?,?,?)")
        .bind((f.get("report_date") || new Date().toISOString().slice(0, 10)).trim(), (f.get("title") || "").trim(), (f.get("body") || "").trim(), now()).run();
      return redirect("/admin?tab=reports");
    }
    if ((m = path.match(/^\/admin\/reports\/(\d+)\/delete$/))) {
      await db.prepare("DELETE FROM daily_reports WHERE id = ?").bind(Number(m[1])).run();
      return redirect("/admin?tab=reports");
    }
    if (path === "/admin/announcements/save") {
      await db.prepare("INSERT INTO announcements (title, body, created_at) VALUES (?,?,?)")
        .bind((f.get("title") || "").trim(), (f.get("body") || "").trim(), now()).run();
      return redirect("/admin?tab=announcements");
    }
    if ((m = path.match(/^\/admin\/announcements\/(\d+)\/delete$/))) {
      await db.prepare("DELETE FROM announcements WHERE id = ?").bind(Number(m[1])).run();
      return redirect("/admin?tab=announcements");
    }
    if ((m = path.match(/^\/admin\/accounts\/(\d+)\/role$/))) {
      const role = f.get("role");
      if (["reader", "premium", "vip"].includes(role)) {
        await db.prepare("UPDATE users SET role = ?, tier_expires_at = NULL WHERE id = ?").bind(role, Number(m[1])).run();
      }
      return redirect("/admin?tab=accounts");
    }
    if ((m = path.match(/^\/admin\/accounts\/(\d+)\/staff$/))) {
      const level = Number(f.get("level"));
      if ([0, 1, 2].includes(level) && Number(m[1]) !== user.id) {
        await db.prepare("UPDATE users SET is_admin = ? WHERE id = ?").bind(level, Number(m[1])).run();
      }
      return redirect("/admin?tab=accounts");
    }
    if ((m = path.match(/^\/admin\/accounts\/(\d+)\/reset-link$/))) {
      const token = randomToken(24);
      await db.prepare("INSERT INTO reset_tokens (token, user_id, expires_at) VALUES (?,?,?)")
        .bind(token, Number(m[1]), now() + 86_400_000).run();
      return redirect(`/admin?tab=accounts&reset=${token}&for=${m[1]}`);
    }
    if ((m = path.match(/^\/admin\/accounts\/(\d+)\/delete$/))) {
      if (Number(m[1]) !== user.id) await db.prepare("DELETE FROM users WHERE id = ?").bind(Number(m[1])).run();
      return redirect("/admin?tab=accounts");
    }
    if ((m = path.match(/^\/admin\/messages\/(\d+)\/read$/))) {
      await db.prepare("UPDATE messages SET is_read = 1 WHERE id = ?").bind(Number(m[1])).run();
      return redirect("/admin?tab=messages");
    }
    if ((m = path.match(/^\/admin\/messages\/(\d+)\/delete$/))) {
      await db.prepare("DELETE FROM messages WHERE id = ?").bind(Number(m[1])).run();
      return redirect("/admin?tab=messages");
    }
    if (path === "/admin/settings/webhook") {
      const origin = new URL(request.url).origin;
      const target = origin + "/webhook/treasury";
      const existing = await listWebhooks(env);
      if (existing.ok) {
        for (const w of existing.webhooks) {
          if (w.url === target || w.url?.endsWith("/webhook/treasury")) await deleteWebhook(env, w.id).catch(() => {});
        }
      }
      const created = await createWebhook(env, target);
      if (created.ok) {
        await setCfg(db, "webhook_id", String(created.id));
        if (created.secret) await setCfg(db, "webhook_secret", created.secret);
        return redirect("/admin?tab=settings&hook=ok");
      }
      return redirect(`/admin?tab=settings&hook=${encodeURIComponent(created.error || "failed")}`);
    }
  }
  return null;
}

function adminShell(tab, inner, admin = true) {
  const tabs = [
    ["articles", "▤ Articles"],
    ["reports", "🗞 Reports"],
    ["announcements", "📢 Announcements"],
    ...(admin
      ? [["accounts", "👤 Accounts"], ["messages", "✉ Messages"], ["settings", "⚙ Settings"]]
      : []),
  ];
  return `${sectionHead("Administration", admin ? "Manage articles and user accounts" : "Writer's desk — manage content", "🛡")}
    <div class="tabs">${tabs.map(([k, label]) => `<a class="tab${tab === k ? " active" : ""}" href="/admin?tab=${k}">${label}</a>`).join("")}</div>
    ${inner}`;
}

async function adminArticles(db) {
  const { results } = await db.prepare("SELECT * FROM articles ORDER BY COALESCE(published_at, created_at) DESC LIMIT 200").all();
  return `<div class="list-meta"><span class="count">${results.length} article${results.length === 1 ? "" : "s"} on record</span>
      <a class="btn" href="/admin/articles/new">+ New Article</a></div>
    ${results.map((a) => articleRow(a, { adminLinks: true })).join("") || notice("No articles yet.")}`;
}

function articleForm(a = {}) {
  const tierSel = (v) => (Number(a.tier ?? 0) === v ? " selected" : "");
  return `<div class="list-meta"><span class="count">${a.id ? `Editing #${a.id}` : "New article"}</span></div>
    <form class="wide" method="POST" action="/admin/articles/save" style="max-width:820px">
      <input type="hidden" name="id" value="${a.id ?? ""}">
      <div class="field"><label>Title</label><input name="title" required value="${esc(a.title ?? "")}"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:18px">
        <div class="field"><label>Category</label><input name="category" value="${esc(a.category ?? "Economy")}"></div>
        <div class="field"><label>Author</label><input name="author" value="${esc(a.author ?? "")}"></div>
        <div class="field"><label>Access tier</label>
          <select name="tier"><option value="0"${tierSel(0)}>Public</option><option value="1"${tierSel(1)}>Premium</option><option value="2"${tierSel(2)}>VIP</option></select></div>
      </div>
      <div class="field"><label>Body</label><textarea name="body" rows="16" required>${esc(a.body ?? "")}</textarea></div>
      <label style="display:flex;align-items:center;gap:10px;margin-top:18px;font-family:var(--mono);font-size:11px;letter-spacing:.2em;text-transform:uppercase">
        <input type="checkbox" name="published" style="width:auto"${(a.published ?? 1) ? " checked" : ""}> Published</label>
      <button class="btn">Save</button>
    </form>`;
}

async function adminReports(db) {
  const { results } = await db.prepare("SELECT * FROM daily_reports ORDER BY report_date DESC, id DESC LIMIT 60").all();
  return `<div class="list-meta"><span class="count">${results.length} report${results.length === 1 ? "" : "s"}</span></div>
    <form class="wide" method="POST" action="/admin/reports/save" style="max-width:820px;margin-bottom:34px">
      <div style="display:grid;grid-template-columns:200px 1fr;gap:18px">
        <div class="field"><label>Date</label><input name="report_date" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
        <div class="field"><label>Title</label><input name="title" required></div>
      </div>
      <div class="field"><label>Body</label><textarea name="body" rows="10" required></textarea></div>
      <button class="btn">Publish report</button>
    </form>
    ${results.map((r) => `<div class="row"><div><div class="cat">${esc(r.report_date)}</div><h3><a href="/daily-report?id=${r.id}">${esc(r.title)}</a></h3></div>
      <form method="POST" action="/admin/reports/${r.id}/delete" onsubmit="return confirm('Delete this report?')"><button class="iconbtn del">🗑</button></form></div>`).join("")}`;
}

async function adminAnnouncements(db) {
  const { results } = await db.prepare("SELECT * FROM announcements ORDER BY created_at DESC LIMIT 60").all();
  return `<form class="wide" method="POST" action="/admin/announcements/save" style="max-width:820px;margin:30px 0 34px">
      <div class="field"><label>Title</label><input name="title" required></div>
      <div class="field"><label>Body</label><textarea name="body" rows="5" required></textarea></div>
      <button class="btn">Post announcement</button>
    </form>
    ${results.map((a) => `<div class="row"><div><div class="cat">${fmtDate(a.created_at)}</div><h3>${esc(a.title)}</h3></div>
      <form method="POST" action="/admin/announcements/${a.id}/delete" onsubmit="return confirm('Delete?')"><button class="iconbtn del">🗑</button></form></div>`).join("")}`;
}

async function adminAccounts(db, url) {
  const { results } = await db.prepare("SELECT id, username, email, role, is_admin, tier_expires_at, created_at FROM users ORDER BY created_at DESC LIMIT 500").all();
  const resetToken = url.searchParams.get("reset");
  const resetFor = url.searchParams.get("for");
  const resetHtml = resetToken
    ? `<div class="notice">One-time reset link for user #${esc(resetFor)} (valid 24h — send it to them):<br>
       <span class="mono">${esc(url.origin)}/reset-password?token=${esc(resetToken)}</span></div>`
    : "";
  return `${resetHtml}<div class="list-meta"><span class="count">${results.length} account${results.length === 1 ? "" : "s"}</span></div>
    <table class="grid"><tr><th>User</th><th>Email</th><th>Subscription</th><th>Staff</th><th>Expires</th><th>Joined</th><th></th></tr>
    ${results
      .map(
        (u) => `<tr>
        <td>${esc(u.username)}${u.is_admin >= 2 ? ' <span class="badge vip">Admin</span>' : u.is_admin === 1 ? ' <span class="badge">Writer</span>' : ""}</td><td class="mono">${esc(u.email ?? "")}</td>
        <td><form method="POST" action="/admin/accounts/${u.id}/role" style="display:flex;gap:8px">
          <select name="role">${["reader", "premium", "vip"].map((r) => `<option value="${r}"${u.role === r ? " selected" : ""}>${r}</option>`).join("")}</select>
          <button class="chip">Set</button></form></td>
        <td><form method="POST" action="/admin/accounts/${u.id}/staff" style="display:flex;gap:8px">
          <select name="level">${[[0, "none"], [1, "writer"], [2, "admin"]].map(([v, l]) => `<option value="${v}"${Number(u.is_admin) === v ? " selected" : ""}>${l}</option>`).join("")}</select>
          <button class="chip">Set</button></form></td>
        <td class="mono">${u.tier_expires_at ? fmtDate(u.tier_expires_at) : "—"}</td>
        <td class="mono">${fmtDate(u.created_at)}</td>
        <td style="white-space:nowrap">
          <form method="POST" action="/admin/accounts/${u.id}/reset-link" style="display:inline"><button class="chip" title="Password reset link">🔑</button></form>
          <form method="POST" action="/admin/accounts/${u.id}/delete" style="display:inline" onsubmit="return confirm('Delete account ${esc(u.username)}?')"><button class="iconbtn del">🗑</button></form>
        </td></tr>`
      )
      .join("")}</table>`;
}

async function adminMessages(db) {
  const { results } = await db.prepare("SELECT * FROM messages ORDER BY is_read ASC, created_at DESC LIMIT 100").all();
  return `<div class="list-meta"><span class="count">${results.length} message${results.length === 1 ? "" : "s"}</span></div>
    ${results
      .map(
        (msg) => `<div class="row" style="align-items:flex-start${msg.is_read ? ";opacity:.55" : ""}">
        <div><div class="cat">${esc(msg.name)}${msg.contact ? ` · ${esc(msg.contact)}` : ""} · ${fmtDate(msg.created_at)}${msg.is_read ? "" : ' <span class="badge">New</span>'}</div>
        <div style="max-width:820px;font-size:16px;line-height:1.6;margin-top:8px">${paragraphs(msg.body)}</div></div>
        <div class="actions">
          ${msg.is_read ? "" : `<form method="POST" action="/admin/messages/${msg.id}/read"><button class="chip">Mark read</button></form>`}
          <form method="POST" action="/admin/messages/${msg.id}/delete" onsubmit="return confirm('Delete message?')"><button class="iconbtn del">🗑</button></form>
        </div></div>`
      )
      .join("") || notice("Inbox is empty.")}`;
}

async function adminSettings(db, env, url) {
  const hook = url.searchParams.get("hook");
  const firm = env.DC_API_TOKEN ? await resolveFirm(env) : null;
  const hookId = await cfg(db, "webhook_id");
  const hasSecret = !!(await cfg(db, "webhook_secret"));
  const pendingCount = (await db.prepare("SELECT COUNT(*) AS n FROM upgrade_orders WHERE status = 'pending'").first()).n;
  return `<div class="list-meta"><span class="count">Treasury & payments</span></div>
    <div class="paybox" style="margin-left:0">
      <div class="kicker">Treasury API</div>
      <p style="margin:12px 0;font-size:16px">${
        !env.DC_API_TOKEN
          ? "❌ <strong>DC_API_TOKEN not set.</strong> Run <span class='mono'>npx wrangler secret put DC_API_TOKEN</span> with the firm's token."
          : firm
            ? `✅ Connected to firm <strong>${esc(firm.firmName)}</strong> (receiving account #${firm.accountId}). Prices: Premium $${PRICES.premium} / VIP $${PRICES.vip} per ${TIER_DAYS} days.`
            : "⚠️ Token set but the firm didn't resolve — check the token is a BUSINESS key."
      }</p>
    </div>
    <div class="paybox" style="margin-left:0">
      <div class="kicker">Payment webhook (instant unlocks)</div>
      <p style="margin:12px 0;font-size:16px">${
        hookId
          ? `✅ Webhook #${esc(hookId)} registered${hasSecret ? " (secret stored)" : " — <strong>no secret stored</strong>, pushes run rate-limited"}.`
          : "Not registered yet. Subscribers can still use the “check now” button, but registering makes unlocks instant."
      }</p>
      <form method="POST" action="/admin/settings/webhook"><button class="btn line">${hookId ? "Re-register webhook" : "Register webhook"}</button></form>
      ${hook === "ok" ? notice("Webhook registered.") : hook ? notice(`Registration failed: ${esc(hook)}`, true) : ""}
      <p class="meta" style="margin-top:14px">Pending upgrade orders: ${pendingCount}</p>
    </div>`;
}
