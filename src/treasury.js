// ---------------------------------------------------------------------------
// treasury.js — DemocracyCraft Treasury API for the news site.
// Ledger-verified payments (same design as the casino bot): a webhook push or
// a "verify" click only triggers a re-read of the firm's real transactions —
// nothing is ever credited from a request body, so forged calls can't unlock
// tiers. Secrets: DC_API_TOKEN (Worker secret, the CLIENT's firm token).
// ---------------------------------------------------------------------------

const BASE = "https://api.democracycraft.net/economy";

// Per-isolate cache of the firm's identity (re-resolved on cold start).
let resolved = null;

async function api(env, method, path, body) {
  if (!env.DC_API_TOKEN) return { ok: false, error: "NO_TOKEN" };
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${env.DC_API_TOKEN}`,
        ...(body != null ? { "Content-Type": "application/json" } : {}),
      },
      body: body != null ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    return { ok: false, error: "NETWORK", message: e.message };
  }
  if (res.status === 204) return { ok: true, data: {} };
  const data = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true, data };
  return { ok: false, status: res.status, error: data.error || `HTTP_${res.status}`, message: data.message || "" };
}

// Resolve firm name + receiving account from the token (BUSINESS scope).
export async function resolveFirm(env) {
  if (resolved) return resolved;
  const me = await api(env, "GET", "/api/v1/firms/me");
  if (!me.ok) return null;
  const firmName = me.data.displayName ?? null;
  let accountId = null;
  if (firmName) {
    const pub = await api(env, "GET", `/api/v1/firms/${encodeURIComponent(firmName)}`);
    if (pub.ok && pub.data.defaultAccountId) accountId = Number(pub.data.defaultAccountId);
  }
  if (!accountId) {
    const accts = await api(env, "GET", "/api/v1/firms/me/accounts");
    if (accts.ok && Array.isArray(accts.data)) {
      const live = accts.data.filter((a) => !a.archived);
      accountId = Number(live[0]?.accountId) || null;
    }
  }
  if (!accountId) return null;
  resolved = { firmName, accountId };
  return resolved;
}

// Recent incoming transactions on the firm's account.
export async function recentTransactions(env, limit = 100) {
  const firm = await resolveFirm(env);
  if (!firm) return { ok: false, error: "NO_FIRM" };
  const r = await api(env, "GET", `/api/v1/accounts/${firm.accountId}/transactions?limit=${limit}`);
  if (!r.ok) return r;
  return { ok: true, items: r.data.items || [] };
}

// Sum of incoming amounts whose memo/message contains `memo` (case-insensitive).
export function sumForMemo(items, memo) {
  const needle = memo.toLowerCase();
  let total = 0;
  let txnId = null;
  for (const t of items) {
    const amt = Number(t.amount);
    if (!(amt > 0)) continue;
    const hay = `${t.memo || ""} ${t.message || ""}`.toLowerCase();
    if (!hay.includes(needle)) continue;
    total += amt;
    txnId ??= t.txnId;
  }
  return { total: Math.round(total * 100) / 100, txnId };
}

// --- Webhook management --------------------------------------------------------
export async function listWebhooks(env) {
  const r = await api(env, "GET", "/api/v1/webhooks");
  if (!r.ok) return r;
  return { ok: true, webhooks: r.data.webhooks || [] };
}
export async function createWebhook(env, url) {
  const r = await api(env, "POST", "/api/v1/webhooks", { url });
  if (!r.ok) return r;
  return { ok: true, id: r.data.id, secret: r.data.secret || null };
}
export async function deleteWebhook(env, id) {
  return api(env, "DELETE", `/api/v1/webhooks/${id}`);
}

// Accept the common webhook signature conventions (raw secret header, Bearer,
// HMAC-SHA256 hex/base64 of the body) — the spec documents the secret but not
// the delivery scheme.
export async function verifyPush(request, rawBody, secret) {
  if (!secret) return false;
  const h = (n) => request.headers.get(n) || "";
  const eq = async (a, b) => {
    const enc = new TextEncoder();
    const [ha, hb] = await Promise.all([
      crypto.subtle.digest("SHA-256", enc.encode(String(a))),
      crypto.subtle.digest("SHA-256", enc.encode(String(b))),
    ]);
    const va = new Uint8Array(ha), vb = new Uint8Array(hb);
    let d = 0;
    for (let i = 0; i < va.length; i++) d |= va[i] ^ vb[i];
    return d === 0;
  };

  for (const name of ["x-webhook-secret", "x-treasury-secret", "x-secret"]) {
    if (h(name) && (await eq(h(name), secret))) return true;
  }
  const auth = h("authorization");
  if (auth.startsWith("Bearer ") && (await eq(auth.slice(7), secret))) return true;

  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const bytes = new Uint8Array(sig);
  const hexSig = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const b64Sig = btoa(String.fromCharCode(...bytes));
  for (const name of ["x-signature", "x-webhook-signature", "x-treasury-signature", "x-hub-signature-256"]) {
    const got = h(name).replace(/^sha256=/i, "");
    if (got && ((await eq(got.toLowerCase(), hexSig)) || (await eq(got, b64Sig)))) return true;
  }
  return false;
}
