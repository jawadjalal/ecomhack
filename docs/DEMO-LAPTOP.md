# Demo laptop setup — run this before judging

> **For the agent on the demo laptop (Jawad's):** work through every step in order, run the commands,
> tick each check, and report back anything that fails. Don't skip the checks. The stage script itself is
> [`DEMO.md`](./DEMO.md); this file gets the machine ready for it. Filming the VANTA loop instead? Follow
> [`VANTA-DEMO.md`](./VANTA-DEMO.md).

**Why local, not Vercel:** the live site runs several copies of the app, each with its own in-memory data,
so dashboards jump between full and empty on refresh (measured: 300 → 0 → 0 → 0 visitors on consecutive
reads). One local process keeps everything in one place. Do this at least 30 minutes before judging.

## 1. Latest code

```bash
git checkout main && git pull
cd apps/web
npm install
```

- [ ] `git log -1` shows the newest merge on `origin/main`
- [ ] `git status` is clean

## 2. Keys (never commit these)

Easiest, if the Vercel CLI is logged in to the team that owns `darwin-storefront`:

```bash
npx vercel link          # pick the darwin-storefront project if asked
npx vercel env pull .env.local
```

Otherwise create `apps/web/.env.local` by hand. What each key does (all optional; everything degrades gracefully):

| Key | Without it |
|---|---|
| `OPENROUTER_API_KEY` (or `XAI_API_KEY`) | AI features ("Ask Darwin", Grok teammate, proposals) fall back to built-in rules |
| `WHOP_API_KEY`, `WHOP_COMPANY_ID` | Onboarding's Whop step connects a labelled demo business |
| `GITHUB_TOKEN` + `DARWIN_TARGET_REPO` | PR cards are dry runs (still shown, just not opened on GitHub) |

- [ ] `grep -c "=" .env.local` > 0 and `.env.local` is listed by `git check-ignore .env.local`
- [ ] **Do not** set `DARWIN_ADMIN_TOKEN` unless you want to sign in at `/console?key=…` first

## 3. Production build, one process

```bash
npm run build
npm start                # http://localhost:3000 — never `npm run dev` on stage
```

- [ ] Build finishes with no errors
- [ ] Keep exactly **one** `npm start` running; don't restart it after step 4 (restarting wipes the demo data)

## 4. Load demo traffic (once)

Open **http://localhost:3000/console/traffic** and click **Send 470 test visitors**, or:

```bash
curl -s -X POST localhost:3000/api/simulate -H 'content-type: application/json' -d '{"humans":150,"agents":20}'
curl -s -X POST localhost:3000/api/web/simulate -H 'content-type: application/json' -d '{"site":"north-trail","visitors":300}'
```

- [ ] `curl -s localhost:3000/api/traffic` shows `"visitors"` ≈ 470 and stays the same on repeat calls
- [ ] Everything simulated is labelled "simulated" in the UI (it must be; never hide that)

## 5. Every page loads

```bash
for p in / /store /console /console/classic /console/traffic /console/agents /console/personalize /console/dashboards /readiness /onboarding; do
  echo "$p $(curl -s -o /dev/null -w '%{http_code}' localhost:3000$p)"; done
```

- [ ] All `200`

## 6. Click-through (by hand, 2 minutes)

- [ ] `/console/traffic`: channels, referring sites, search queries, countries fill in; **What to improve** shows cards
- [ ] Click **Ask Darwin** on Traffic: the header says "Written by …<model>" (AI key working) or "Built-in rules" (no key; fine)
- [ ] Set the Site selector to **north-trail**, click **Draft A/B test** on a card → "Draft saved: review in Personalize"
- [ ] Under *Try it*, click **From X (Twitter)**, then check Traffic → Referring sites shows *X (Twitter)*
- [ ] `/readiness`: audit any store URL
- [ ] `/onboarding`: runs end to end. **GitHub sign-in won't work on localhost** (the OAuth app's callback is the Vercel URL): paste a repo URL or use the script-tag option instead, or register a second OAuth app with callback `http://localhost:3000/api/auth/github/callback`
- [ ] `DEMO.md`'s keyboard shortcuts (`space`, `a`, `t`, `s`, `b`, `r`, `f`) were written for the original mission control, now at **`/console/classic`**. Check them there; if the new `/console` has its own controls, use those in the stage script

## 7. Stage hygiene

- [ ] Only **one** browser tab on the console (two tabs = autopilot runs twice as fast)
- [ ] Laptop on charge, notifications off, browser zoom so the back row can read the charts
- [ ] Offline fallback ready: `http://localhost:3000/console?mock=1` (or `/console/classic?mock=1`) runs the loop in the browser

## Known issues (as of 2026-09-26 afternoon)

- `src/lib/briefing/briefing.test.ts` › "asks to ship a winning store agent test…" **fails on main** (CI and locally):
  it expects the line to end with "(simulated traffic)." and the store-agent line now ends differently. 505/506 tests pass;
  the app builds and runs. Fix the test or the wording when there's time; it doesn't block the demo.
- Live Vercel dashboards are unreliable (see top). Use this laptop.
