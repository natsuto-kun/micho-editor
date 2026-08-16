import { create } from "zustand";

export interface SectionEntry {
  id: string;
  scenarioId: string;
  parentId: string;
  kind: string;
  title: string;
  sortKey: string;
  rev: number;
  updatedAt: number;
  dirty: boolean;
  saveError?: string;
}

interface ScenarioStore {
  scenarioId: string;
  scenarioTitle: string;
  sections: SectionEntry[];

  setScenario: (id: string, title: string) => void;
  setSections: (metas: Array<Omit<SectionEntry, "dirty" | "saveError">>) => void;
  upsertSection: (meta: Omit<SectionEntry, "dirty" | "saveError">) => void;
  removeSection: (id: string) => void;
  markDirty: (id: string) => void;
  markSaved: (id: string, rev: number) => void;
  markSaveError: (id: string, error: string) => void;
  revOf: (id: string) => number;
  isDirty: (id: string) => boolean;
}

export const useScenarioStore = create<ScenarioStore>((set, get) => ({
  scenarioId: "",
  scenarioTitle: "",
  sections: [],

  setScenario: (id, title) => set({ scenarioId: id, scenarioTitle: title }),

  setSections: (metas) =>
    set({ sections: metas.map((m) => ({ ...m, dirty: false })) }),

  upsertSection: (meta) =>
    set((state) => {
      const idx = state.sections.findIndex((s) => s.id === meta.id);
      const entry: SectionEntry = { ...meta, dirty: false };
      if (idx >= 0) {
        const next = [...state.sections];
        next[idx] = { ...next[idx], ...entry };
        return { sections: next };
      }
      return { sections: [...state.sections, entry] };
    }),

  removeSection: (id) =>
    set((state) => ({ sections: state.sections.filter((s) => s.id !== id) })),

  markDirty: (id) =>
    set((state) => ({
      sections: state.sections.map((s) =>
        s.id === id ? { ...s, dirty: true } : s
      ),
    })),

  markSaved: (id, rev) =>
    set((state) => ({
      sections: state.sections.map((s) =>
        s.id === id ? { ...s, rev, dirty: false, saveError: undefined } : s
      ),
    })),

  markSaveError: (id, error) =>
    set((state) => ({
      sections: state.sections.map((s) =>
        s.id === id ? { ...s, saveError: error } : s
      ),
    })),

  revOf: (id) => get().sections.find((s) => s.id === id)?.rev ?? 1,

  isDirty: (id) => get().sections.find((s) => s.id === id)?.dirty ?? false,
}));
