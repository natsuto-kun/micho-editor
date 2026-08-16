import { create } from "zustand";

interface UIStore {
  activeSectionId: string | null;
  setActiveSectionId: (id: string | null) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  activeSectionId: null,
  setActiveSectionId: (id) => set({ activeSectionId: id }),
}));
