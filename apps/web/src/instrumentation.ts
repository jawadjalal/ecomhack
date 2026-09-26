/**
 * Runs once per server start, fire and forget (`register` must finish before the server takes requests):
 *
 * 1. Demo store (off with DARWIN_DEMO_SEED=0), see lib/demo. A restarted server (loop state is on disk, simulated
 *    events never are) gets one round of simulated shoppers, so the Overview's cards agree with the generations
 *    the loop remembers. A fresh deploy with no repo or darwin.js site connected runs the loop to Gen 1 with a
 *    test live.
 * 2. Whop: a WHOP_API_KEY on the server counts as connected (Settings, the store agent's business name).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const [{ bootSeedEnabled, demoStatus, ensureDemoStore }, { connectServerWhop }] = await Promise.all([import("@/lib/demo"), import("@/lib/whop")]);

  setTimeout(() => {
    connectServerWhop()
      .then((c) => {
        if (c) console.log(`[whop] server key connected: ${c.title}`);
      })
      .catch((err) => console.warn("[whop] couldn't connect the server key on boot:", (err as Error).message));

    if (!bootSeedEnabled()) return;
    let demo = true;
    try {
      demo = demoStatus().mode === "demo";
    } catch (err) {
      console.warn("[demo] couldn't read the demo status on boot", err);
      return;
    }
    ensureDemoStore(undefined, { seed: demo })
      .then(({ action, steps, status }) => {
        if (action !== "none") console.log(`[demo] demo store ${action} on boot (${steps} loop steps, Gen ${status.generation}); all simulated`);
      })
      .catch((err) => console.warn("[demo] boot seeding failed", err));
  }, 250);
}
