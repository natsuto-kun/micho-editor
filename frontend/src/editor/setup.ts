import { EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  highlightActiveLine,
  drawSelection,
  lineNumbers,
} from "@codemirror/view";
import {
  history,
  historyKeymap,
  defaultKeymap,
} from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";
import { autosave } from "./autosave";
import { livePreview } from "./live-preview";

export function createEditorState(doc: string, sectionId: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      EditorView.lineWrapping,
      lineNumbers(),
      history({ minDepth: 50, newGroupDelay: 300 }),
      drawSelection(),
      highlightActiveLine(),
      search({ top: true }),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
      markdown({ base: markdownLanguage }),
      syntaxHighlighting(defaultHighlightStyle),
      livePreview,
      autosave(sectionId),
    ],
  });
}

export function createEditorView(
  parent: HTMLElement,
  doc: string,
  sectionId: string
): EditorView {
  return new EditorView({
    state: createEditorState(doc, sectionId),
    parent,
  });
}
