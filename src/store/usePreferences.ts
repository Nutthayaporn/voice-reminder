import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { AlertMode } from '../brain/types';
import type { SttEngineId } from '../speech/types';

interface PreferencesState {
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
