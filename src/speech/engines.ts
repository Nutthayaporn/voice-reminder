// Describes the selectable STT engines and whether each can run right now,
// so the toggle can label them and explain any that are unavailable.

import { Platform } from 'react-native';
import { isGroqConfigured } from '../config';
import { isDeviceSttAvailable } from './deviceStt';
import { isWebSttAvailable } from './webStt';
import type { EngineInfo } from './types';

export function getEngines(): EngineInfo[] {
  if (Platform.OS === 'web') {
    const webReady = isWebSttAvailable();
    return [
      {
        id: 'web',
        label: 'Browser',
        hint: 'Web Speech API · Thai supported on Chrome and Edge',
        available: webReady,
        unavailableReason: webReady
          ? undefined
          : 'This browser does not support Web Speech API. Use Chrome or Edge.',
      },
    ];
  }

  const groqReady = isGroqConfigured();
  const deviceReady = isDeviceSttAvailable();

  return [
    {
      id: 'cloud',
      label: 'Cloud',
      hint: 'Groq Whisper · High Thai accuracy · Internet required',
      available: groqReady,
      unavailableReason: groqReady
        ? undefined
        : 'EXPO_PUBLIC_GROQ_API_KEY is not configured',
    },
    {
      id: 'device',
      label: 'On-device',
      hint: 'On-device · Fast · Works offline',
      available: deviceReady,
      unavailableReason: deviceReady
        ? undefined
        : 'Requires a development build and is unavailable in Expo Go',
    },
  ];
}
