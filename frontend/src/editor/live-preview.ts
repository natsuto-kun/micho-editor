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

class DirectiveHeaderWidget extends WidgetType {
  constructor(
    readonly type: DirectiveBlock["type"],
    readonly params: string
  ) {
    super();
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof DirectiveHeaderWidget &&
      other.type === this.type &&
      other.params === this.params
    );
  }

  toDOM(_view: EditorView): HTMLElement {
    const el = document.createElement("div");
    el.className = `directive-header directive-${this.type}-header`;

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = this.type.toUpperCase();
    el.appendChild(badge);

    const parts = this.params.split("|").map((p) => p.trim());

    if (this.type === "npc" && parts[0]) {
      const nameEl = document.createElement("span");
      nameEl.className = "name";
      nameEl.textContent = parts[0];
      el.appendChild(nameEl);
      if (parts[1]) {
        const metaEl = document.createElement("span");
        metaEl.className = "meta";
        metaEl.textContent = parts.slice(1).join(" / ");
        el.appendChild(metaEl);
      }
    } else if (this.type === "handout" && parts[0]) {
      const idEl = document.createElement("span");
      idEl.className = "id";
      idEl.textContent = parts[0];
      el.appendChild(idEl);
      if (parts[1]) {
        const targetEl = document.createElement("span");
        targetEl.className = "target";
        targetEl.textContent = `→ ${parts[1]}`;
        el.appendChild(targetEl);
      }
    }

    return el;
  }

  ignoreEvent(_event: Event): boolean {
    return false;
  }
}

class DirectiveFooterWidget extends WidgetType {
  constructor(readonly type: DirectiveBlock["type"]) {
    super();
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof DirectiveFooterWidget && other.type === this.type
    );
  }

  toDOM(_view: EditorView): HTMLElement {
    const el = document.createElement("div");
    el.className = `directive-footer directive-${this.type}-footer`;
    return el;
  }

  ignoreEvent(_event: Event): boolean {
    return false;
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const cursor = view.state.selection.main.head;
  const doc = view.state.doc;
  const blocks = parseDirectiveBlocks(doc, view.visibleRanges);
  const builder = new RangeSetBuilder<Decoration>();

  for (const block of blocks) {
    const openLine = doc.lineAt(block.from);
    const closeLine = doc.lineAt(block.to);

    const cursorOnOpen = cursor >= openLine.from && cursor <= openLine.to;
    const cursorOnClose = cursor >= closeLine.from && cursor <= closeLine.to;

    // Opening line: replaced by header widget unless cursor is on it
    if (!cursorOnOpen) {
      const openEnd = Math.min(openLine.to + 1, doc.length);
      builder.add(
        openLine.from,
        openEnd,
        Decoration.replace({
          widget: new DirectiveHeaderWidget(block.type, block.params),
          block: true,
        })
      );
    }

    // Body lines: styled via line decoration — text remains editable
    for (let n = openLine.number + 1; n <= closeLine.number - 1; n++) {
      const line = doc.line(n);
      builder.add(
        line.from,
        line.from,
        Decoration.line({
          class: `directive-body directive-${block.type}-body`,
        })
      );
    }

    // Closing line: replaced by footer widget unless cursor is on it
    if (!cursorOnClose) {
      const closeEnd = Math.min(closeLine.to + 1, doc.length);
      builder.add(
        closeLine.from,
        closeEnd,
        Decoration.replace({
          widget: new DirectiveFooterWidget(block.type),
          block: true,
        })
      );
    }
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
  }
);
