import { create } from "zustand";

interface UIStore {
  activeSectionId: string | null;
  setActiveSectionId: (id: string | null) => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  activeSectionId: null,
  setActiveSectionId: (id) => set({ activeSectionId: id }),
  searchOpen: false,
  setSearchOpen: (open) => set({ searchOpen: open }),
}));
