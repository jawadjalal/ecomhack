# VANTA filming runbook

Film the live Darwin loop on the VANTA storefront in under 2 minutes. Nothing is replayed: the loop runs on simulated
shoppers and AI shoppers, and the console labels them "synthetic" / "simulated".

Film **`/console/classic`** (the loop ring, stage panel and hotkeys), not the new `/console`. Its A/B previews,
before/after view and PR cards all render **`/vanta`** from the live PageSpec (`?previewSpec=` for proposals).

## 1. Before the first take

1. **Swap the product photos.** `apps/web/public/store/*.jpg` are copies of the VOLT demo's placeholders:
   `camera-hero.jpg` shows phones under "M1 Rangefinder", `camera.jpg` and `watch.jpg` are the same laptop, and
   `headphones.jpg` and `speaker.jpg` are the same headphones. Drop real photos in under the same names (hero about
   2080×756 on a dark background, tiles about 1672×940). No code change is needed. Swap them before you build; if you
   swap them later, delete `apps/web/.next/cache/images` and restart, or Next keeps serving the old ones for up to 4 hours.
2. **Env:** put the block from section 2 in `apps/web/.env.local` (it's in `.env.example` too).
3. **One production process, fresh state:**

   ```bash
   cd apps/web
   rm -rf .data
   npm run build && npm start      # http://localhost:3000
   ```

4. **Two tabs:** `http://localhost:3000/vanta` and `http://localhost:3000/console/classic`. Only one console tab: the
   tab drives autopilot, so two tabs step twice as fast. In the console's top bar, Traffic and Autopilot are both off.

## 2. Env for the take

```bash
LLM_PROVIDER=none
DARWIN_DEMO_SEED=0
DARWIN_SEED=42
DARWIN_DEMO_HUMANS=8000
DARWIN_DEMO_AGENTS=800
DARWIN_ROUND_HUMANS=16000
DARWIN_ROUND_AGENTS=300
DARWIN_MIN_ARM_VISITORS=4000
DARWIN_MIN_ARM_AGENTS=500
DARWIN_MAX_ROUNDS=2
DARWIN_GITHUB_DRY_RUN=1
```

- `LLM_PROVIDER=none` keeps the loop on its built-in playbook even if LLM keys are set, so every take proposes the same
  changes in the same order. `DARWIN_GITHUB_DRY_RUN=1` makes every PR a labelled dry-run preview.
- `DARWIN_DEMO_SEED=0` keeps a fresh server at Gen 0 (by default boot runs it to Gen 1).
- Seed 42 is the base seed of the loop's simulated rounds. Takes still differ a little (experiment ids, and so the A/B
  split, are random), which is why reliability below is counted over 16 resets.
- Volumes don't set the pace: the console steps every 2.5 s and a step computes in 0.0–0.7 s, so smaller volumes would
  only make winners noisier. `ROUND_HUMANS` is 4× `MIN_ARM_VISITORS`. Agent tests run 3× `ROUND_AGENTS` per round
  (~450 per arm, under `MIN_ARM_AGENTS` on purpose): round 1 shows the running gauge, round 2 decides.

## 3. What to expect (measured on the production build, simulated traffic)

Autopilot from a reset at the console's cadence (first step after 1.2 s, then every 2.5 s) with traffic on
(12 humans + 3 AI shoppers per batch):

| Gen | Shipped after | Change (judged on) | Result |
|---|---|---|---|
| 1 | 15.0 s | Expose per-size stock to AI shoppers (AI shoppers) | 18.61% (n=935) → 28.90% (n=865), +55.3%, P(B beats A) 100% |
| 2 | 31.8 s | One-page guest checkout with express pay (humans) | +27.9%, P 99.97% |
| – | – | Low-stock urgency on product pages (humans) | inconclusive (−1.2%), not shipped |
| 3 | 59.4 s | Delivery ETA + JSON-LD for AI shoppers (AI shoppers) | +40.5% |
| 4 | 76.2 s | Sticky add-to-bag + reviews + delivery estimate (humans) | +15.4%, P 99.22% |

| Gen | Humans convert | AI shoppers buy | Overall |
|---|---|---|---|
| 0 | 2.27% | 16.81% | 3.60% |
| 1 | 2.42% | 29.50% | 4.89% |
| 2 | 3.04% | 30.74% | 5.56% |
| 3 | 3.24% | 37.16% | 6.33% |
| 4 | 3.65% | 40.00% | 6.96% |

In Chrome on `/console/classic`, Gen 1 shipped about 16 s after pressing A. Over 16 reset-and-run repeats, Gen 1 shipped
at step 6 (about 15 s) every time, checkout and JSON-LD shipped 16/16, and the sticky + reviews change shipped 13/16
(two inconclusive, one still running).

What `/vanta` looks like:

| | Gen 0 (after a reset) | Gen 4 (what the loop shipped) |
|---|---|---|
| Buy button | faint grey "Add to bag" link (1.44:1 contrast on white, 1.57:1 on black) | blue pill (4.70:1) plus a sticky buy bar |
| Delivery | "+£9.95 delivery" under every price, below a "Free engraving and next-day delivery" banner | "4 in stock — delivery Thursday, £9.95" |
| Ratings | none | stars and review counts on every product |
| For AI shoppers | no JSON-LD, empty alt text, no stock | JSON-LD for 4 products (stock, ratings), descriptive alt text, stock counts |

`/vanta/after` is a static reference of the full target page (free delivery banner, trust strip, returns, quotes). It is
not loop output: don't present it as what Darwin shipped.

## 4. Click path (about 1:50)

Step with **Space** so the voice-over sets the pace (autopilot moves a phase every 2.5 s, faster than the lines).
Keep **Traffic** on from beat 2: it feeds the live feed and keeps the tiles and funnels refreshing.

| Beat | Time | Screen | Do |
|---|---|---|---|
| 1. The human leaves | 0:00 | `/vanta` tab | Scroll the M1 hero and the grid. Hover the faint grey **Add to bag** (it only jumps to the product). Point at "+£9.95 delivery" under the price while the banner promises free next-day delivery. Scroll away. |
| 2. The agent hits a wall | 0:15 | console | Press **T**. Simulated AI shoppers arrive in **Agent-to-agent** (right). Pick an **Abandoned** one from the agent chips: ✗ `check_availability · no stock`, "Left because: no stock levels exposed". |
| 3. Captured | 0:27 | console | **Space** → Observe: KPI tiles, human and AI-shopper funnels with the "biggest leak", Friction chips ("Missing field · stock"), the live feed. |
| 4. Insight | 0:37 | console | **Space** → Diagnose: "91% of AI shoppers asked for stock levels: we don't expose it", ranked by orders lost per 1,000. |
| 5. Hypothesis and variant | 0:47 | console | **Space** → Propose: the diff (`agentSurface.exposeStock` false → true), A · Control and B · Treatment previews of `/vanta`, and "What AI agents see" gaining a stock line. |
| 6. A/B test | 0:57 | console | **Space** → Experiment, round 1: A vs B bars, 50/50, "AI shoppers only", the gauge (chance B beats A) against its 97.5% mark. Round 1 never ships an agent test: too few AI shoppers per arm yet. |
| 7. Compare | 1:07 | console | **Space** → Decide, round 2: **SHIP**, "Treatment wins: +N% conversion with 100% probability of beating control", with the 95% interval. |
| 8. Pull request | 1:15 | console | **Space** → Ship: "Generation 1 is live", AI shoppers e.g. 17% → 28% (Humans: "Not counted: judged on AI shoppers"), the **PR preview (dry run)** card. Click it for the PR, **Esc**. The Evolution chart gains a G1 point. |
| 9. The loop again | 1:30 | console, then `/vanta` | Press **A**: autopilot carries on (Gen 2 about 17 s later, Gen 4 about a minute later). Cut to Gen 4 and reload the `/vanta` tab: blue buy pill, sticky bar, ratings, stock and delivery line. Or press **B** for Gen 0 vs now side by side. |
| 10. Close | 1:45 | console | Evolution chart or the **B** view: humans and AI shoppers both up since Gen 0. "Behaviour → insight → page change → better outcome, for humans and AI agents, shipped as PRs you review." |

Hands-free instead: press **T** and **A** after beat 2. Gen 1 ships about 15 s later; narrate fast or slow the footage in the edit.

## 5. Hotkeys (`/console/classic`)

| Key | Does |
|---|---|
| **A** | Autopilot on/off |
| **T** | Simulated traffic on/off (also turns on live refresh) |
| **Space** | One loop step (only while autopilot is off) |
| **B** | Before/after: Gen 0 vs the live store |
| **R** | Reset dialog; **Enter** confirms |
| **S** | "Send an AI shopper with a brief" box (its briefs are PACE shoes: not needed for this script) |
| **F** | Fullscreen |
| **Esc** | Close the open dialog or panel |

Hotkeys are ignored while a dialog is open (before/after, PR): press **Esc** first.

## 6. Reset between takes

- **R**, then **Enter**: events, experiments, agent sessions and the live spec go back to Gen 0 in a second or two.
  Autopilot turns off; Traffic stays as it was (press **T** to switch it off). Reload the `/vanta` tab.
- Hard reset: stop `npm start`, `rm -rf apps/web/.data`, start it again.

## 7. Known issues to film around

1. **Placeholder photos** (section 1): the first shot shows phones under "M1 Rangefinder" until they're replaced.
2. **The simulator and the agent API still sell PACE running shoes:** the live feed and agent transcripts say things like
   "Trail shoes in UK 10" and "Ridge Trail Pro". Frame the "Left because" line and the stage panel; keep the feed small.
3. **The human tile jumps at the Gen 1 ship** (about 2.8%, "+22% vs Gen 0"; the Evolution chart and B view too) although
   the change was judged on AI shoppers only. It's measured on the test's small human sample and settles (about 2.4%)
   at the next Observe. The Ship card says "Not counted": narrate the AI-shopper tile.
4. **Gen 1 barely changes `/vanta`** (a stock line per product). The obvious human-facing change ships at Gen 4, in
   13 of 16 runs. If the Activity log says it was inconclusive, reset and retake.
5. **Gen 2 (checkout) is invisible on VANTA**, which has no checkout page: its A and B previews look identical.
6. **The delivery charge survives Gen 4:** "delivery Thursday, £9.95" still sits under the free-delivery banner. The
   loop didn't ship the free-delivery fix in these runs.
7. **Wording:** the playbook label says "per-size stock" (shoe wording), and the Experiment row says humans "can't see
   this change" while VANTA also prints the stock line for humans.
8. **Numbers are simulated** and differ a little per take. Say so if asked.
