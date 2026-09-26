import { describe, expect, it } from "vitest";
import { friendlyError, friendlyStatus, plainNote, writtenBy } from "./friendly";

describe("friendlyError", () => {
  it("passes friendly server messages through", () => {
    expect(friendlyError(new Error("Too many checks from this address. Try again in a few minutes."))).toBe(
      "Too many checks from this address. Try again in a few minutes.",
    );
  });

  it("hides endpoints, verbs, JSON shapes and env vars", () => {
    for (const m of [
      "Make a plan first (POST /api/onboarding/plan)",
      "GET /api/dashboards?site=x → 500",
      "HTTP 502",
      "Body must be JSON: { apiKey? }",
      "?site= is required",
      "No key and no WHOP_API_KEY on the server",
      "llm:deepseek/deepseek-v4-flash timed out",
    ]) {
      const out = friendlyError(m, "Fallback.");
      expect(out).toBe("Fallback.");
    }
  });

  it("uses the status when there is one", () => {
    const err = Object.assign(new Error("POST /api/loop/step → 500"), { status: 500 });
    expect(friendlyError(err)).toBe(friendlyStatus(500));
  });

  it("explains network failures", () => {
    expect(friendlyError(new TypeError("Failed to fetch"))).toMatch(/Couldn't reach Darwin/);
  });
});

describe("writtenBy", () => {
  it("never names a model or provider", () => {
    expect(writtenBy("llm:deepseek/deepseek-v4-flash")).toEqual({ ai: true, label: "Written by Darwin AI" });
    expect(writtenBy("llm:grok-4").label).not.toMatch(/grok/i);
    expect(writtenBy("heuristic")).toEqual({ ai: false, label: "Built-in rules" });
    expect(writtenBy("sample").label).toBe("Sample");
  });
});

describe("plainNote", () => {
  it("drops server setting names but keeps the meaning", () => {
    expect(plainNote("Dry run: GITHUB_TOKEN is not set, so no branch or PR was created.")).toBe(
      "Preview: GitHub isn't connected, so no branch or pull request was created.",
    );
    expect(plainNote("Dry run (DARWIN_GITHUB_DRY_RUN=1): the repository was read but no branch or PR was created.")).toBe(
      "Preview: the repository was read but no branch or pull request was created.",
    );
    expect(plainNote("Darwin isn't connected to GitHub yet (no GITHUB_TOKEN), so the pull request will be a preview.")).toBe(
      "Darwin isn't connected to GitHub yet, so the pull request will be a preview.",
    );
  });
});
