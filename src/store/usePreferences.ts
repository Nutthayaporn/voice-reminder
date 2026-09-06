import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { PersonalDefaults } from '../domain/defaults';
import type { AlertMode } from '../brain/types';
import type { SttEngineId } from '../speech/types';

interface PreferencesState {
  personalDefaults: Record<string, PersonalDefaults>;
  setPersonalDefaults: (owner: string, value: PersonalDefaults) => void;
  entityAliases: Record<string, Record<string, string[]>>;
  setEntityAliases: (owner: string, entityId: string, aliases: string[]) => void;
  spaceAliases: Record<string, Record<string, string[]>>;
  setSpaceAliases: (owner: string, spaceId: string, aliases: string[]) => void;
  preferredEngine: SttEngineId | null;
  handsFreeEnabled: boolean;
  autoStopEnabled: boolean;
  defaultAlertMode: AlertMode;
  activeHouseholdId: string | null;
  setPreferredEngine: (engine: SttEngineId) => void;
  setHandsFreeEnabled: (enabled: boolean) => void;
  setAutoStopEnabled: (enabled: boolean) => void;
  setDefaultAlertMode: (mode: AlertMode) => void;
  setActiveHouseholdId: (id: string | null) => void;
}

export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      personalDefaults: {},
      setPersonalDefaults: (owner, value) => set((s) => ({ personalDefaults: { ...s.personalDefaults, [owner]: value } })),
      entityAliases: {},
      setEntityAliases: (owner, entityId, aliases) => set((state) => ({ entityAliases: {
        ...state.entityAliases,
        [owner]: { ...state.entityAliases[owner], [entityId]: [...new Set(aliases.map((a) => a.trim()).filter(Boolean))] },
      } })),
      spaceAliases: {},
      setSpaceAliases: (owner, spaceId, aliases) => set((state) => ({ spaceAliases: {
        ...state.spaceAliases,
        [owner]: { ...state.spaceAliases[owner], [spaceId]: [...new Set(aliases.map((a) => a.trim()).filter(Boolean))] },
      } })),
      preferredEngine: null,
      handsFreeEnabled: false,
      autoStopEnabled: true,
      defaultAlertMode: 'notification',
      activeHouseholdId: null,
      setPreferredEngine: (preferredEngine) => set({ preferredEngine }),
      setHandsFreeEnabled: (handsFreeEnabled) => set({ handsFreeEnabled }),
      setAutoStopEnabled: (autoStopEnabled) => set({ autoStopEnabled }),
      setDefaultAlertMode: (defaultAlertMode) => set({ defaultAlertMode }),
      setActiveHouseholdId: (activeHouseholdId) => set({ activeHouseholdId }),
    }),
    {
      name: 'voice-reminder/preferences',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
      migrate: (persistedState, version) => {
        const state = persistedState as Partial<PreferencesState>;
        return version < 1 ? { ...state, handsFreeEnabled: false } : state;
      },
    },
  ),
);
