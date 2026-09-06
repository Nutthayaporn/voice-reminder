// Text-to-speech — the "talk back" half of the voice loop.
//
// Uses the OS voice via expo-speech (free and offline). Wrapped behind a tiny
// module so a cloud voice (OpenAI /
// ElevenLabs / Google) can replace it later without changing callers.

import * as Speech from 'expo-speech';
import { prepareTextForSpeech, speechLanguageFor } from './speechText';

export interface SpeakOptions {
  language?: string;
  onDone?: () => void;
  onStopped?: () => void;
  onError?: (message: string) => void;
}

export function speak(text: string, opts: SpeakOptions = {}): void {
  if (!text.trim()) {
    opts.onDone?.();
    return;
  }
  const spokenText = prepareTextForSpeech(text);
  Speech.stop(); // never overlap two utterances
  Speech.speak(spokenText, {
    language: opts.language ?? speechLanguageFor(spokenText),
    rate: 1.0,
    pitch: 1.0,
    onDone: opts.onDone,
    onStopped: opts.onStopped,
    onError: (e) => opts.onError?.(String(e)),
  });
}

export function stopSpeaking(): void {
  Speech.stop();
}
