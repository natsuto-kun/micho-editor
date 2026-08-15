import { useEffect, useRef } from "react";
import { EditorView } from "@codemirror/view";
import { createEditorView } from "./editor/setup";

const INITIAL_DOC = `# TRPG シナリオエディタ

ここに本文を書きます。
`;

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const view = createEditorView(containerRef.current, INITIAL_DOC);
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <div
        ref={containerRef}
        style={{ flex: 1, overflow: "auto" }}
      />
    </div>
  );
}
