import { create } from 'zustand';
import { listHouseholds, listMembers, type Household } from '../store/households';
import { usePreferences } from '../store/usePreferences';
import { useStore } from '../store/useStore';

interface SpacesState {
  ownerId: string | null;
  spaces: Household[];
  error: string | null;
  loading: boolean;
  refresh: () => Promise<Household[]>;
}
let generation = 0;
export const useSpaces = create<SpacesState>((set) => ({
  ownerId: null, spaces: [], error: null, loading: false,
  refresh: async () => {
    const request = ++generation;
    const ownerId = useStore.getState().userId;
    set((state) => ({ ownerId, spaces: state.ownerId === ownerId ? state.spaces : [], loading: !!ownerId, error: null }));
    if (!ownerId) { set({ spaces: [], loading: false }); return []; }
    try {
      const rows = await listHouseholds();
      const aliases = usePreferences.getState().spaceAliases[ownerId] ?? {};
      const spaces = await Promise.all(rows.map(async (row) => ({ ...row, aliases: aliases[row.id] ?? [], members: await listMembers(row.id).catch(() => []) })));
      if (request !== generation || useStore.getState().userId !== ownerId) return [];
      set({ spaces, loading: false });
      return spaces;
    } catch (error) {
      if (request === generation) set({ loading: false, error: 'Could not load spaces. Retry when connected.' });
      throw error;
    }
  },
}));
