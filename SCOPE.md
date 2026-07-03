# Redmont's Economic News — rebuild

Client job (via Discord, "XD [DC]"): rebuild the existing base44 AI-generated site
as a proper custom website. Price TBD with client.

Reference site: https://redmonts-economic-news.base44.app/
Tagline: "The official digital broadsheet of DemocracyCraft, delivering
high-stakes economic intelligence, government policy updates, and exclusive
legislative insights."

## Page inventory (from the live site)

Public:
- Home
- News Stories (article list)
- Article Detail
- Announcements
- Daily Report
- Search

Auth:
- Login / Register / Forgot Password / Reset Password

Gated:
- Premium News  (paid tier?)
- VIP News      (higher tier?)
- Admin Panel   (client offered admin access + screenshots)

## Open questions (client / Hen)

- [ ] Admin panel screenshots — what management features exist?
- [ ] How are Premium/VIP unlocked? Manual role grant, or paid (DC treasury)?
      If paid: Treasury webhook flow (same as casino bot) = instant unlock.
- [ ] Branding: keep the existing logo/colors or fresh design?
- [ ] Who writes content — single admin or multiple editor roles?
- [ ] Hosting: Cloudflare Workers + D1 (same stack as Jaronite/GFC)?
- [ ] Domain: workers.dev or custom?

## Decisions

- Stack: **Cloudflare Worker + D1** (same pattern as Jaronite News and GFC):
  server-rendered pages, session-cookie auth, roles (reader / premium / vip /
  editor / admin), articles + announcements + daily reports tables.
- Paywall: **paid via DC treasury** — user gets a unique memo, pays the
  client's firm in-game, a Treasury webhook (same as casino bot) upgrades
  their tier instantly. Ledger re-read on push = forgery-proof.

## Still needed before/while building

- [ ] Admin panel screenshots from client
- [ ] Tier prices (Premium / VIP) + duration (permanent? monthly?)
- [ ] Client's firm treasury token (`/treasuryapi business issue`) — money
      must land in THEIR firm, set as a Worker secret at deploy
- [ ] Branding assets or approval to redesign
- [ ] Which Cloudflare account hosts it (client's own is cleaner for handoff)
