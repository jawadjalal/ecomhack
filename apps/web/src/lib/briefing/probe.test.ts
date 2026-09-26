import { it } from "vitest";
import { eventStore } from "@/lib/analytics/store";
import { resetAgentTests, resetCatalog, resetStoreAgent, runSimulatedBuyers, startAgentTest } from "@/lib/store-agent";
import { getBriefing } from ".";

it("probe", async () => {
  for (const [n, seed] of [[300, 1], [400, 2], [500, 3], [600, 4]]) {
    eventStore().clear(); resetCatalog(); resetStoreAgent(); resetAgentTests();
    startAgentTest("facts");
    await runSimulatedBuyers(n, "https://darwin.example", seed);
    const b = await getBriefing({ origin: "https://darwin.example" });
    console.log(n, seed, JSON.stringify(b, null, 1));
  }
}, 60000);
