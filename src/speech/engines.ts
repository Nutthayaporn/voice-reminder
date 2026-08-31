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
        hint: 'Web Speech API · Chrome/Edge รองรับภาษาไทย',
        available: webReady,
        unavailableReason: webReady
          ? undefined
          : 'เบราว์เซอร์นี้ไม่รองรับ Web Speech API (แนะนำ Chrome หรือ Edge)',
      },
    ];
  }

  const groqReady = isGroqConfigured();
  const deviceReady = isDeviceSttAvailable();

  return [
    {
      id: 'cloud',
      label: 'Cloud',
      hint: 'Groq Whisper · แม่นภาษาไทยสูง · ต้องต่อเน็ต',
      available: groqReady,
      unavailableReason: groqReady
        ? undefined
        : 'ยังไม่ได้ตั้งค่า EXPO_PUBLIC_GROQ_API_KEY',
    },
    {
      id: 'device',
      label: 'On-device',
      hint: 'ในเครื่อง · เร็ว · ออฟไลน์ได้',
      available: deviceReady,
      unavailableReason: deviceReady
        ? undefined
        : 'ต้องรันเป็น dev build (ไม่รองรับใน Expo Go)',
    },
  ];
}
