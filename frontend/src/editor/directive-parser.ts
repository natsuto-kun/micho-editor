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
// NOTE: ネストした directive は非対応。内側の ::: が外側ブロックの閉じ行と誤認識される。
const END_RE = /^:::\s*$/;

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
      // NOTE: 閉じ行は visible range 外まで走査する場合がある（開始行が visible でも閉じ行が invisible な場合）
      for (let cn = n + 1; cn <= doc.lines; cn++) {
        const cl = doc.line(cn);
        if (END_RE.test(cl.text)) {
          closingLine = cl;
          break;
        }
      }
      if (!closingLine) continue;

      processed.add(line.from);
      const bodyFrom = line.to + 1;
      blocks.push({
        type: m[1] as DirectiveBlock["type"],
        params: m[2].trim(),
        from: line.from,
        to: closingLine.to,
        bodyFrom,
        bodyTo: Math.max(bodyFrom, closingLine.from - 1),
      });
      n = closingLine.number;
    }
  }

  return blocks;
}
