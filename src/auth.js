// ---------------------------------------------------------------------------
// auth.js — password hashing (PBKDF2 via WebCrypto), sessions, cookies.
// ---------------------------------------------------------------------------

const SESSION_COOKIE = "ren_session";
const SESSION_DAYS = 30;
const PBKDF2_ITERS = 100_000;

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export function randomToken(bytes = 32) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return hex(a.buffer);
}

export async function hashPassword(password, saltHex) {
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERS },
    key,
    256
  );
  return hex(bits);
}

export async function verifyPassword(password, saltHex, expectedHex) {
  const got = await hashPassword(password, saltHex);
  // constant-time-ish compare
  if (got.length !== expectedHex.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  return diff === 0;
}

// --- Sessions ----------------------------------------------------------------
export async function createSession(db, userId) {
  const token = randomToken();
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  await db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").bind(token, userId, expires).run();
  return { token, expires };
}

export async function destroySession(db, token) {
  if (token) await db.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
}

export function readSessionToken(request) {
  const cookie = request.headers.get("Cookie") || "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([a-f0-9]+)`));
  return m ? m[1] : null;
}

// Returns the user row (or null). Cleans up expired sessions lazily.
export async function getSessionUser(db, request) {
  const token = readSessionToken(request);
  if (!token) return null;
  const row = await db
    .prepare(
      `SELECT u.*, s.expires_at AS session_expires FROM sessions s
       JOIN users u ON u.id = s.user_id WHERE s.token = ?`
    )
    .bind(token)
    .first();
  if (!row) return null;
  if (row.session_expires < Date.now()) {
    await destroySession(db, token);
    return null;
  }
  return row;
}

export function sessionSetCookie(token) {
  const maxAge = SESSION_DAYS * 86_400;
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function sessionClearCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

// --- Tiers --------------------------------------------------------------------
// Staff (is_admin) is SEPARATE from the subscription tier. effectiveRole only
// ever returns the subscription: reader / premium / vip, with expiry applied
// at read time (no cron needed).
export function effectiveRole(user) {
  if (!user) return null;
  if (user.role === "admin") return "reader"; // legacy value safety
  if ((user.role === "premium" || user.role === "vip") && user.tier_expires_at && user.tier_expires_at < Date.now()) {
    return "reader";
  }
  return user.role;
}

const RANK = { reader: 0, premium: 1, vip: 2 };
export function canReadTier(user, tier) {
  // tier: 0 public, 1 premium, 2 vip. Staff read everything (they manage it).
  if (tier <= 0) return true;
  if (!user) return false;
  if (Number(user.is_admin) >= 1) return true;
  return (RANK[effectiveRole(user)] ?? 0) >= tier;
}

// Staff levels (is_admin column): 0 none · 1 writer · 2 admin.
export function isAdmin(user) {
  return !!user && Number(user.is_admin) >= 2;
}
export function isWriter(user) {
  // writer OR admin — anyone allowed into the content side of the panel
  return !!user && Number(user.is_admin) >= 1;
}
