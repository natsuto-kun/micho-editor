import { useCallback, useEffect, useRef } from "react";
import { EditorView } from "@codemirror/view";
import { EventsOn } from "../wailsjs/runtime/runtime";
import { createEditorView } from "./editor/setup";
import { Outline } from "./components/Outline";
import { useScenarioStore } from "./stores/scenarioStore";
import { useUIStore } from "./stores/uiStore";
import * as API from "./api/bindings";

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  const setScenario = useScenarioStore((s) => s.setScenario);
  const setSections = useScenarioStore((s) => s.setSections);
  const upsertSection = useScenarioStore((s) => s.upsertSection);
  const scenarioId = useScenarioStore((s) => s.scenarioId);

  const activeSectionId = useUIStore((s) => s.activeSectionId);
  const setActiveSectionId = useUIStore((s) => s.setActiveSectionId);

  // Flush current editor content to the backend.
  const flushCurrent = useCallback(async () => {
    const id = useUIStore.getState().activeSectionId;
    if (!viewRef.current || !id) return;
    const store = useScenarioStore.getState();
    if (!store.isDirty(id)) return;
    const body = viewRef.current.state.doc.toString();
    const rev = store.revOf(id);
    try {
      const res = await API.saveSection(id, body, rev);
      store.markSaved(id, res.rev);
    } catch (e) {
      store.markSaveError(id, String(e));
    }
  }, []);

  // Load scenario and sections on mount.
  useEffect(() => {
    async function init() {
      const scenario = await API.openScenario();
      setScenario(scenario.id, scenario.title);
      const metas = await API.listSections(scenario.id);
      setSections(metas);
    }
    init();
  }, []);

  // Handle section switch: flush current → destroy editor → load new section → mount editor.
  const switchSection = useCallback(
    async (id: string) => {
      if (id === useUIStore.getState().activeSectionId) return;
      await flushCurrent();

      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }

      const section = await API.getSection(id);
      setActiveSectionId(id);

      if (containerRef.current) {
        viewRef.current = createEditorView(
          containerRef.current,
          section.body,
          id
        );
      }
    },
    [flushCurrent]
  );

  // Auto-select first section when sections load and none is active.
  const sections = useScenarioStore((s) => s.sections);
  useEffect(() => {
    if (sections.length > 0 && !useUIStore.getState().activeSectionId) {
      const first = [...sections].sort((a, b) =>
        a.sortKey < b.sortKey ? -1 : 1
      )[0];
      switchSection(first.id);
    }
  }, [sections.length]);

  // Flush on window blur.
  useEffect(() => {
    window.addEventListener("blur", flushCurrent);
    return () => window.removeEventListener("blur", flushCurrent);
  }, [flushCurrent]);

  // Flush before app close.
  useEffect(() => {
    const off = EventsOn("beforeClose", async () => {
      await flushCurrent();
      await API.ackFlush();
    });
    return off;
  }, [flushCurrent]);

  // Add a new section at the end.
  const handleAddSection = useCallback(async () => {
    const sid = useScenarioStore.getState().scenarioId;
    if (!sid) return;
    const secs = useScenarioStore.getState().sections;
    const lastId =
      secs.length > 0
        ? [...secs].sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1)).at(-1)!
            .id
        : "";
    const meta = await API.createSection(
      sid,
      "",
      "scene",
      "新規セクション",
      lastId
    );
    upsertSection(meta);
    await switchSection(meta.id);
  }, [switchSection]);

  return (
    <div style={{ height: "100vh", display: "flex", overflow: "hidden" }}>
      {/* Sidebar */}
      <div style={{ width: 240, flexShrink: 0, display: "flex", flexDirection: "column" }}>
        <Outline
          onSectionClick={switchSection}
          onAddSection={handleAddSection}
        />
      </div>

      {/* Editor pane */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {activeSectionId === null && (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#475569",
              fontSize: "14px",
            }}
          >
            セクションを選択するか「+ セクション追加」をクリックしてください
          </div>
        )}
        <div
          ref={containerRef}
          style={{
            flex: 1,
            overflow: "auto",
            display: activeSectionId !== null ? "block" : "none",
          }}
        />
      </div>
    </div>
  );
}
