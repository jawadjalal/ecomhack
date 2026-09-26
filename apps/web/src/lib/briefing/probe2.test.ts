import { it, vi } from "vitest";
import { eventStore } from "@/lib/analytics/store";
import { getLoopState } from "@/lib/optimizer";
import { stepLoop } from "@/lib/optimizer/loop";
import { actOnBriefing, getBriefing } from ".";

it("probe loop", async () => {
  vi.stubEnv("GITHUB_TOKEN", "");
  vi.stubEnv("DARWIN_GITHUB_DRY_RUN", "1");
  vi.spyOn(console, "info").mockImplementation(() => {});
  eventStore().clear();
  const cfg = { config: { observeHumans: 3000, observeAgents: 300, roundHumans: 3000, roundAgents: 200, maxRounds: 3 }, useLlm: false };
  let ships = 0, stops = 0;
  for (let i = 0; i < 80 && (ships < 1 || stops < 1); i++) {
    const before = getLoopState();
    if (before.phase === "decide") {
      const b = await getBriefing({ origin: "https://darwin.example" });
      const item = b.items.find((x) => x.kind === "loop" && x.actions.length);
      if (item) {
        const action = item.actions[0];
        if ((action === "ship" && ships === 0) || (action === "stop" && stops === 0)) {
          console.log("DECIDE", JSON.stringify(b, null, 1));
          const other = action === "ship" ? "stop" : "ship";
          console.log("ACT-other", other, JSON.stringify(await actOnBriefing(item.id, other)));
          const res = await actOnBriefing(item.id, action);
          console.log("ACT", action, JSON.stringify(res));
          console.log("AFTER", JSON.stringify(await getBriefing({ origin: "https://darwin.example" }), null, 1));
          if (action === "ship") ships++; else stops++;
          continue;
        }
      }
    }
    if (before.phase === "experiment" && i % 4 === 0) {
      const b = await getBriefing({ origin: "https://darwin.example" });
      console.log("EXPERIMENT", b.text);
      const item = b.items.find((x) => x.kind === "loop" && x.status !== "shipped" && x.status !== "stopped");
      if (item) console.log("ACT-ship-running", JSON.stringify(await actOnBriefing(item.id, "ship")), JSON.stringify(await actOnBriefing(item.id, "stop")));
    }
    await stepLoop(cfg);
  }
}, 120000);
