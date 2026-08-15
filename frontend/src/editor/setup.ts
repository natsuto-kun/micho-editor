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

export function createEditorState(doc: string): EditorState {
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
    ],
  });
}

export function createEditorView(
  parent: HTMLElement,
  doc: string
): EditorView {
  return new EditorView({
    state: createEditorState(doc),
    parent,
  });
}
