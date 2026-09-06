export type ReplyLanguage = 'th' | 'en';
export interface PersonalDefaults { timePhrases: Record<string, string>; leadMinutes: number | null; responseLanguage: ReplyLanguage | 'auto' }
export const initialDefaults: PersonalDefaults = { timePhrases: {}, leadMinutes: null, responseLanguage: 'auto' };
export function replyLanguage(preference: PersonalDefaults['responseLanguage'], input: string): ReplyLanguage { return preference === 'auto' ? /[ก-๙]/.test(input) ? 'th' : 'en' : preference; }
export function validTime(value: string): boolean { return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value); }
export function changeDefaults(current: PersonalDefaults, key: string, value: string | null): PersonalDefaults {
  if (key === 'response_language') {
    if (value !== 'th' && value !== 'en' && value !== 'auto') throw new Error('Choose Thai, English or auto.');
    return { ...current, responseLanguage: value };
  }
  if (key === 'reminder_lead_minutes') {
    if (value === null) return { ...current, leadMinutes: null };
    const n = Number(value);
    if (!value.trim() || !Number.isInteger(n) || n < 0 || n > 43200) throw new Error('Lead time must be 0–43200 minutes.');
    return { ...current, leadMinutes: n };
  }
  const phrase = key.trim();
  if (!phrase || phrase.length > 80 || (value !== null && !validTime(value))) throw new Error('Use a phrase and a time in HH:mm format.');
  const phrases = { ...current.timePhrases };
  if (value === null) delete phrases[phrase]; else phrases[phrase] = value;
  return { ...current, timePhrases: phrases };
}
