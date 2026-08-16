import { EditorView } from "@codemirror/view";
import { saveSection } from "../api/bindings";
import { useScenarioStore } from "../stores/scenarioStore";

const IDLE_MS = 800;
const MAX_INTERVAL_MS = 5000;

export function autosave(sectionId: string) {
  let timer: number | undefined;
  let firstDirtyAt = 0;

  const flush = (view: EditorView) => {
    window.clearTimeout(timer);
    timer = undefined;
    firstDirtyAt = 0;
    const body = view.state.doc.toString();
    const rev = useScenarioStore.getState().revOf(sectionId);
    saveSection(sectionId, body, rev)
      .then((res) => useScenarioStore.getState().markSaved(sectionId, res.rev))
      .catch((e) =>
        useScenarioStore.getState().markSaveError(sectionId, String(e))
      );
  };

  return EditorView.updateListener.of((u) => {
    if (!u.docChanged) return;
    if (u.view.composing) return; // IME 変換確定前は保存しない

    useScenarioStore.getState().markDirty(sectionId);

    const now = Date.now();
    if (!firstDirtyAt) firstDirtyAt = now;

    if (now - firstDirtyAt >= MAX_INTERVAL_MS) {
      flush(u.view);
      return;
    }
    window.clearTimeout(timer);
    timer = window.setTimeout(() => flush(u.view), IDLE_MS);
  });
}
