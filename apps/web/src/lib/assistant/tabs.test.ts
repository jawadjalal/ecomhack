import { describe, expect, it, vi } from "vitest";
import {
  fetchReply,
  groupTitle,
  mentionTarget,
  nextGroupTab,
  parseGroupInvite,
  readGroups,
  readThread,
  removeThread,
  threadKey,
  writeGroups,
  writeThread,
  type GroupChat,
  type TabStore,
} from "./tabs";

function memory(): TabStore & { dump: Map<string, string> } {
  const dump = new Map<string, string>();
  return {
    dump,
    getItem: (k) => dump.get(k) ?? null,
    setItem: (k, v) => {
      dump.set(k, v);
    },
    removeItem: (k) => {
      dump.delete(k);
    },
  };
}

describe("crew names in group invites", () => {
  it("opens a tab for Pixel and Fizz by their display names", () => {
    const invite = parseGroupInvite("get Pixel and Fizz on the headline fix");
    expect(invite).not.toBeNull();
    expect(invite!.members).toEqual(["darwin", "theo", "ada"]);
    expect(invite!.job).toBe("Headline fix");
    expect(invite!.title).toBe("Headline fix - Darwin + Pixel + Fizz");
    expect(groupTitle("Headline fix", invite!.members)).toBe(invite!.title);
  });

  it("does not treat a single 'ask Iris' as a new group tab", () => {
    expect(parseGroupInvite("ask Iris where shoppers get stuck")).toBeNull();
  });

  it("opens another tab when a different crew is named from inside a group", () => {
    const current = ["darwin", "theo", "ada"] as const;
    expect(nextGroupTab(undefined, "get Pixel and Fizz on the headline fix")?.title).toBe("Headline fix - Darwin + Pixel + Fizz");
    expect(nextGroupTab(current, "get Pixel and Fizz on the headline fix")).toBeNull();
    expect(nextGroupTab(current, "loop in Iris and Dash about checkout")?.members).toEqual(["darwin", "iris", "max"]);
  });

  it("resolves an @mention to the crew id", () => {
    expect(mentionTarget("@Fizz is the test safe?", ["darwin", "theo", "ada"])).toBe("ada");
    expect(mentionTarget("@Dash ship it", ["darwin", "theo", "ada"])).toBeUndefined();
  });
});

describe("group tab persistence", () => {
  it("keeps each tab's messages across a reload and drops a closed group", () => {
    const store = memory();
    const group: GroupChat = {
      id: "g_headline",
      job: "Headline fix",
      title: "Headline fix - Darwin + Pixel + Fizz",
      members: ["darwin", "theo", "ada"],
      createdAt: "2026-09-26T12:00:00.000Z",
    };
    writeGroups(store, [group]);
    writeThread(store, "darwin", [{ role: "user", content: "How are we doing?" }]);
    writeThread(store, group.id, [
      { role: "user", content: "get Pixel and Fizz on the headline fix" },
      { role: "assistant", content: "Pixel drafted a shorter headline." },
    ]);

    const again = memory();
    for (const [k, v] of store.dump) again.dump.set(k, v);
    expect(readGroups(again)).toEqual([group]);
    expect(readThread(again, "darwin")).toEqual([{ role: "user", content: "How are we doing?" }]);
    expect(readThread(again, group.id)).toHaveLength(2);
    expect(threadKey(group.id)).toBe("darwin.assistant.thread.g_headline");

    removeThread(again, group.id);
    writeGroups(again, []);
    expect(readGroups(again)).toEqual([]);
    expect(readThread(again, group.id)).toEqual([]);
    expect(readThread(again, "darwin")).toHaveLength(1);
  });
});

describe("stalled reply timeout", () => {
  it("retries once after a stall and then returns the reply", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      calls++;
      return new Promise<Response>((resolve, reject) => {
        const signal = init?.signal;
        if (calls === 1) {
          const onAbort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          if (signal?.aborted) onAbort();
          else signal?.addEventListener("abort", onAbort, { once: true });
          return;
        }
        resolve(new Response(JSON.stringify({ reply: "ok" }), { status: 200 }));
      });
    });
    const pending = fetchReply("/api/assistant", { method: "POST", body: "{}" }, { timeoutMs: 25, retries: 1, fetchImpl: fetchImpl as unknown as typeof fetch });
    await vi.advanceTimersByTimeAsync(30);
    const res = await pending;
    expect(calls).toBe(2);
    expect(await res.json()).toEqual({ reply: "ok" });
    vi.useRealTimers();
  });

  it("rejects after the retry so a stalled reply cannot sit forever", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        const onAbort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        if (signal?.aborted) onAbort();
        else signal?.addEventListener("abort", onAbort, { once: true });
      });
    });
    const pending = fetchReply("/api/assistant", { method: "POST" }, { timeoutMs: 20, retries: 1, fetchImpl: fetchImpl as unknown as typeof fetch });
    const caught = pending.then(
      () => "resolved",
      (err: Error) => err.name,
    );
    await vi.advanceTimersByTimeAsync(50);
    expect(await caught).toBe("AbortError");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
