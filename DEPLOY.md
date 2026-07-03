# Deploying Redmont's Economic News

Run everything from this folder.

## 1. One-time setup

```
npm install
npx wrangler login          # ideally the CLIENT's Cloudflare account
npx wrangler d1 create ren-db
```

Paste the printed `database_id` into `wrangler.toml`, then:

```
npx wrangler d1 execute ren-db --remote --file=schema.sql
npx wrangler secret put DC_API_TOKEN   # the CLIENT's firm token (/treasuryapi business issue)
npx wrangler deploy
```

## 2. First run

1. Open the deployed URL and **register — the first account becomes admin.**
2. Go to **Admin → Settings** and check the Treasury card shows the client's
   firm. Click **Register webhook** — payments now unlock Premium/VIP instantly.
3. Confirm prices in `src/index.js` (`PRICES`, `TIER_DAYS`) match what the
   client wants, redeploy if you change them.

## 3. How payments work

- A logged-in reader picks Premium or VIP → gets a unique `REN…` memo and the
  exact `/pay-account business <firm> <price> <memo>` command.
- They pay in-game; the Treasury webhook pings the site; the site re-reads the
  firm's **real ledger** and upgrades the account. Forged webhook calls can't
  unlock anything — money is only ever confirmed from the ledger.
- Fallback: the "I've paid — check now" button and a 5s auto-poll on the page.
- Subscriptions last `TIER_DAYS` (default 30); expiry is enforced at read time,
  no cron needed. Repeat purchases extend from the current expiry.

## 4. Handoff notes

- Password resets: admin panel → Accounts → 🔑 makes a one-time link (24h).
  No email sending is required anywhere.
- Admin → Accounts can set any user's role manually (comped subs, extra admins).
- Content: Articles (with Public/Premium/VIP tier + draft support),
  Daily Reports, Announcements — all under /admin.
- The site is fully server-rendered; there is no client framework to maintain.
