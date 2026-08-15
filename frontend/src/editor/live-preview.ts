import {
  ViewPlugin,
  DecorationSet,
  EditorView,
  ViewUpdate,
  Decoration,
} from "@codemirror/view";

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(_view: EditorView) {
      this.decorations = Decoration.none;
    }

    update(u: ViewUpdate) {
      if (u.view.composing) return; // IME 変換中は装飾を再構築しない
      // M0.5: 装飾なし。M3 で :::npc 等のウィジェット実装を追加する
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
