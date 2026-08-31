import { requireOptionalNativeModule } from 'expo-modules-core';

export interface NativeAlarmStatus {
  supported: boolean;
  authorized: boolean;
  canRequest: boolean;
}

interface VoiceAlarmNativeModule {
  getStatusAsync(): Promise<NativeAlarmStatus>;
  requestAuthorizationAsync(): Promise<boolean>;
  scheduleAsync(options: {
    itemId: string;
    title: string;
    timestampMs: number;
    frequency: string | null;
    weekdays: string[] | null;
    interval: number;
    remindUntilDone: boolean;
    snoozeMinutes: number;
    maxAttempts: number;
  }): Promise<string | null>;
  cancelAsync(identifier: string): Promise<void>;
  consumeCompletedItemIdsAsync(): Promise<string[]>;
}

const VoiceAlarm = requireOptionalNativeModule<VoiceAlarmNativeModule>('VoiceAlarm');

export default VoiceAlarm;
