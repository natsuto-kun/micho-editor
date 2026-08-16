import { Text } from "@codemirror/state";

export interface DirectiveBlock {
  type: "npc" | "handout" | "secret";
  params: string;
  from: number;
  to: number;
  bodyFrom: number;
  bodyTo: number;
}

const START_RE = /^:::(npc|handout|secret)\s*(.*)/;
const END_RE = /^:::$/;

export function parseDirectiveBlocks(
  doc: Text,
  visibleRanges: readonly { from: number; to: number }[]
): DirectiveBlock[] {
  const blocks: DirectiveBlock[] = [];
  const processed = new Set<number>();

  for (const range of visibleRanges) {
    const startLine = doc.lineAt(range.from);
    const endLine = doc.lineAt(Math.min(range.to, doc.length));

    for (let n = startLine.number; n <= endLine.number; n++) {
      const line = doc.line(n);
      if (processed.has(line.from)) continue;

      const m = START_RE.exec(line.text);
      if (!m) continue;

      let closingLine: ReturnType<typeof doc.line> | null = null;
      for (let cn = n + 1; cn <= doc.lines; cn++) {
        const cl = doc.line(cn);
        if (END_RE.test(cl.text)) {
          closingLine = cl;
          break;
        }
      }
      if (!closingLine) continue;

      processed.add(line.from);
      blocks.push({
        type: m[1] as DirectiveBlock["type"],
        params: m[2].trim(),
        from: line.from,
        to: closingLine.to,
        bodyFrom: line.to + 1,
        bodyTo: closingLine.from - 1,
      });
      n = closingLine.number;
    }
  }

  return blocks;
}
