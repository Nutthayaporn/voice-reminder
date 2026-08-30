// Local-first store (zustand + AsyncStorage), same pattern as daily-budget.
// Works fully offline on one device; Supabase cloud sync can layer on later
// without changing this interface.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Item } from './types';

interface StoreState {
  items: Item[];
  hasHydrated: boolean;
  addItem: (item: Item) => void;
  removeItem: (id: string) => void;
  toggleDone: (id: string) => void;
}

export const useStore = create<StoreState>()(
  persist(
    (set) => ({
      items: [],
      hasHydrated: false,
      addItem: (item) => set((s) => ({ items: [item, ...s.items] })),
      removeItem: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
      toggleDone: (id) =>
        set((s) => ({
          items: s.items.map((i) => (i.id === id ? { ...i, done: !i.done } : i)),
        })),
    }),
    {
      name: 'voice-reminder/items',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ items: s.items }),
      onRehydrateStorage: () => (state) => {
        // Flip the flag once cache is loaded so the UI can wait for it.
        useStore.setState({ hasHydrated: true });
        void state;
      },
    },
  ),
);
