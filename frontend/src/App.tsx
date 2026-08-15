import { useEffect, useRef, useState } from "react";
import { EditorView } from "@codemirror/view";
import { createEditorView } from "./editor/setup";

const INITIAL_DOC = `# TRPG シナリオエディタ

ここに日本語を入力して IME 変換を確認してください。

例: 「にほんご」と入力して漢字に変換してみてください。
`;

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [composing, setComposing] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const view = createEditorView(containerRef.current, INITIAL_DOC, "m0-debug");
    viewRef.current = view;

    const dom = view.dom;
    const onStart = () => setComposing(true);
    const onEnd = () => setComposing(false);
    dom.addEventListener("compositionstart", onStart);
    dom.addEventListener("compositionend", onEnd);

    return () => {
      dom.removeEventListener("compositionstart", onStart);
      dom.removeEventListener("compositionend", onEnd);
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <div
        style={{
          padding: "4px 12px",
          background: composing ? "#f59e0b" : "#1e293b",
          color: composing ? "#000" : "#94a3b8",
          fontSize: "12px",
          fontFamily: "monospace",
          transition: "background 0.1s",
        }}
      >
        {composing ? "⌨ IME 変換中 — composing: true" : "composing: false"}
      </div>
      <div
        ref={containerRef}
        style={{ flex: 1, overflow: "auto" }}
      />
    </div>
  );
}
