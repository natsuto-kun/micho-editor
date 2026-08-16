import { describe, it, expect } from "vitest";
import { Text } from "@codemirror/state";
import { parseDirectiveBlocks } from "./directive-parser";

function makeDoc(content: string) {
  return Text.of(content.split("\n"));
}

function fullRange(doc: Text) {
  return [{ from: 0, to: doc.length }];
}

describe("parseDirectiveBlocks", () => {
  it("detects a basic npc block", () => {
    const doc = makeDoc(":::npc 田中 | 探偵 | 35\nbody text\n:::");
    const blocks = parseDirectiveBlocks(doc, fullRange(doc));

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("npc");
    expect(blocks[0].params).toBe("田中 | 探偵 | 35");
    expect(doc.sliceString(blocks[0].bodyFrom, blocks[0].bodyTo)).toBe("body text");
  });

  it("detects handout and secret blocks", () => {
    const content = ":::handout HO1 | PlayerA\n内容\n:::\n:::secret\n秘密\n:::";
    const doc = makeDoc(content);
    const blocks = parseDirectiveBlocks(doc, fullRange(doc));

    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("handout");
    expect(blocks[0].params).toBe("HO1 | PlayerA");
    expect(blocks[1].type).toBe("secret");
    expect(blocks[1].params).toBe("");
  });

  it("handles empty body", () => {
    const doc = makeDoc(":::npc 田中 | 探偵 | 35\n:::");
    const blocks = parseDirectiveBlocks(doc, fullRange(doc));

    expect(blocks).toHaveLength(1);
    const body =
      blocks[0].bodyFrom <= blocks[0].bodyTo
        ? doc.sliceString(blocks[0].bodyFrom, blocks[0].bodyTo)
        : "";
    expect(body).toBe("");
  });

  it("ignores unclosed blocks", () => {
    const doc = makeDoc(":::npc 田中 | 探偵 | 35\nbody text");
    const blocks = parseDirectiveBlocks(doc, fullRange(doc));
    expect(blocks).toHaveLength(0);
  });

  it("returns nothing for plain text", () => {
    const doc = makeDoc("# 見出し\n本文テキスト");
    const blocks = parseDirectiveBlocks(doc, fullRange(doc));
    expect(blocks).toHaveLength(0);
  });

  it("scans only visible ranges", () => {
    const doc = makeDoc(":::npc 田中 | 探偵 | 35\nbody\n:::\n後続テキスト");
    // visible range covers only the last line
    const lastLine = doc.line(doc.lines);
    const blocks = parseDirectiveBlocks(doc, [
      { from: lastLine.from, to: lastLine.to },
    ]);
    expect(blocks).toHaveLength(0);
  });
});
