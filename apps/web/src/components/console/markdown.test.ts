import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./markdown";

describe("parseMarkdown", () => {
  it("parses the constructs Darwin's PR bodies use", () => {
    const blocks = parseMarkdown(
      [
        "> [!NOTE]",
        "> **Dry run** only.",
        "",
        "## Results",
        "",
        "| Arm | CR |",
        "|---|---|",
        "| control | 2.1% |",
        "| treatment | 2.8% |",
        "",
        "- one",
        "- two",
        "",
        "```json",
        '{ "a": 1 }',
        "```",
        "",
        "Plain text with `code`.",
      ].join("\n"),
    );
    expect(blocks.map((b) => b.kind)).toEqual(["quote", "heading", "table", "list", "code", "paragraph"]);
    expect(blocks[0]).toMatchObject({ callout: "NOTE", lines: ["**Dry run** only."] });
    expect(blocks[2]).toMatchObject({ header: ["Arm", "CR"], rows: [["control", "2.1%"], ["treatment", "2.8%"]] });
    expect(blocks[4]).toMatchObject({ lang: "json", code: '{ "a": 1 }' });
  });
});
