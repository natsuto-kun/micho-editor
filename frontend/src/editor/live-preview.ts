import {
  ViewPlugin,
  DecorationSet,
  EditorView,
  ViewUpdate,
  Decoration,
  WidgetType,
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { parseDirectiveBlocks, DirectiveBlock } from "./directive-parser";
import { NpcWidget } from "./widgets/NpcWidget";
import { HandoutWidget } from "./widgets/HandoutWidget";
import { SecretWidget } from "./widgets/SecretWidget";

function makeWidget(block: DirectiveBlock, body: string): WidgetType {
  switch (block.type) {
    case "npc": return new NpcWidget(block.params, body);
    case "handout": return new HandoutWidget(block.params, body);
    case "secret": return new SecretWidget(body);
    default: {
      const _exhaustive: never = block.type;
      throw new Error(`Unknown directive type: ${_exhaustive}`);
    }
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const cursor = view.state.selection.main.head;
  const blocks = parseDirectiveBlocks(view.state.doc, view.visibleRanges);
  const builder = new RangeSetBuilder<Decoration>();

  for (const block of blocks) {
    if (cursor >= block.from && cursor <= block.to) continue;

    const body =
      block.bodyFrom <= block.bodyTo
        ? view.state.doc.sliceString(block.bodyFrom, block.bodyTo)
        : "";

    const widget = makeWidget(block, body);
    builder.add(block.from, block.to, Decoration.replace({ widget, block: true }));
  }

  return builder.finish();
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(u: ViewUpdate) {
      if (u.view.composing) return;
      if (u.docChanged || u.selectionSet || u.viewportChanged) {
        this.decorations = buildDecorations(u.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of(
        (view) => view.plugin(plugin)?.decorations ?? Decoration.none
      ),
  }
);
