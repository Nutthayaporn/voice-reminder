import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { AlertMode } from '../brain/types';
import type { SttEngineId } from '../speech/types';

interface PreferencesState {
  preferredEngine: SttEngineId | null;
  defaultAlertMode: AlertMode;
  activeHouseholdId: string | null;
  setPreferredEngine: (engine: SttEngineId) => void;
  setDefaultAlertMode: (mode: AlertMode) => void;
  setActiveHouseholdId: (id: string | null) => void;
}

export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      preferredEngine: null,
      defaultAlertMode: 'notification',
      activeHouseholdId: null,
      setPreferredEngine: (preferredEngine) => set({ preferredEngine }),
      setDefaultAlertMode: (defaultAlertMode) => set({ defaultAlertMode }),
      setActiveHouseholdId: (activeHouseholdId) => set({ activeHouseholdId }),
    }),
    {
      name: 'voice-reminder/preferences',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
