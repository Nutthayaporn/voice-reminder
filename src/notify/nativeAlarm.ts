import VoiceAlarm from '../../modules/voice-alarm';
import type { Item } from '../store/types';

/** Returns the native identifier, or null when the OS/module cannot provide a real alarm. */
export async function scheduleNativeAlarm(item: Item): Promise<string | null> {
  if (!VoiceAlarm || !item.start_at) return null;
  try {
    let status = await VoiceAlarm.getStatusAsync();
    if (!status.supported) return null;
    if (!status.authorized && status.canRequest) {
      await VoiceAlarm.requestAuthorizationAsync();
      status = await VoiceAlarm.getStatusAsync();
    }
    if (!status.authorized) return null;
    return await VoiceAlarm.scheduleAsync({
      itemId: item.id,
      title: item.title,
      timestampMs: new Date(item.start_at).getTime(),
      frequency: item.recurrence?.freq ?? null,
      weekdays: item.recurrence?.byday ?? null,
      interval: item.recurrence?.interval ?? 1,
      remindUntilDone: item.remind_until_done,
      snoozeMinutes: item.snooze_minutes,
      maxAttempts: item.max_attempts,
    });
  } catch {
    return null;
  }
}

/** Native alarm actions can finish while JS is suspended; consume them on app resume. */
export async function consumeCompletedNativeAlarmItemIds(): Promise<string[]> {
  if (!VoiceAlarm) return [];
  try {
    return await VoiceAlarm.consumeCompletedItemIdsAsync();
  } catch {
    return [];
  }
}

export async function cancelNativeAlarm(identifier: string): Promise<void> {
  if (!VoiceAlarm) return;
  try {
    await VoiceAlarm.cancelAsync(identifier);
  } catch {
    // It may already have fired or been removed from system settings.
  }
}
