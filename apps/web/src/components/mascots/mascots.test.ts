import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { MascotState } from "@/lib/contracts/team";
import { TEAM } from "@/lib/team/roster";

const DIR = path.resolve(__dirname, "../../../public/mascots");
const STATES: MascotState[] = ["idle", "thinking", "working", "success", "error", "sleeping", "tapped"];

describe("team mascots", () => {
  it("has every state for every agent's mascot", () => {
    for (const a of TEAM) for (const s of STATES) expect(existsSync(path.join(DIR, `${a.mascot}-${s}.svg`)), `${a.mascot}-${s}.svg`).toBe(true);
  });

  it("keeps every class, id and keyframe prefixed per kind and state (so copies can be inlined side by side)", () => {
    for (const a of TEAM) {
      for (const s of STATES) {
        const svg = readFileSync(path.join(DIR, `${a.mascot}-${s}.svg`), "utf8");
        const names = [...svg.matchAll(/(?:id|class)="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/));
        expect(names.length).toBeGreaterThan(0);
        for (const n of names) expect(n, `${a.mascot}-${s}: ${n}`).toMatch(/^dm[a-z]-[a-z]{2}-/);
        // The component resizes the root and scopes the reduced-motion rule; both rely on this shape.
        expect(svg).toMatch(/<svg [^>]*width="\d+" height="\d+" role="img" aria-label="[^"]*"/);
        expect(svg).toMatch(/@media \(prefers-reduced-motion:\s?reduce\)\{\*\{/);
      }
    }
  });

  it("rests quietly: the idle loops are slow and the sparkle/glint layers are off", () => {
    for (const a of TEAM) {
      const svg = readFileSync(path.join(DIR, `${a.mascot}-idle.svg`), "utf8");
      const secs = [...svg.matchAll(/animation:[a-z0-9-]+ (\d*\.?\d+)s/g)].map((m) => Number(m[1]));
      expect(Math.min(...secs), a.mascot).toBeGreaterThanOrEqual(2);
      expect(svg).toMatch(/-id-gl[^{]*\{animation:none!important;opacity:0!important\}/);
    }
  });
});

describe("team roster", () => {
  it("has unique ids and names, a mascot each, and tools with labels", () => {
    expect(new Set(TEAM.map((a) => a.id)).size).toBe(TEAM.length);
    expect(new Set(TEAM.map((a) => a.name)).size).toBe(TEAM.length);
    expect(TEAM.find((a) => a.id === "darwin")?.mascot).toBe("leader");
    for (const a of TEAM) {
      expect(a.tools?.length, a.id).toBeGreaterThan(0);
      for (const t of a.tools ?? []) expect(t.label.trim(), `${a.id}.${t.name}`).not.toBe("");
    }
  });

  it("marks merges, PRs, file writes and shipping as ask-first", () => {
    for (const a of TEAM)
      for (const t of a.tools ?? []) if (/^(merge_pr|open_pr|propose_file_edit|ship_winner|set_autopilot|reset_loop)$/.test(t.name)) expect(t.confirm, `${a.id}.${t.name}`).toBe(true);
  });
});
