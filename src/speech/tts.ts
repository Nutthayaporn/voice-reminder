// Text-to-speech — the "talk back" half of the voice loop.
//
// Uses the OS voice via expo-speech (free, offline, has a Thai voice on both
// iOS and Android). Wrapped behind a tiny module so a cloud voice (OpenAI /
// ElevenLabs / Google) can replace it later without changing callers.

import * as Speech from 'expo-speech';
import { config } from '../config';

export interface SpeakOptions {
  onDone?: () => void;
  onError?: (message: string) => void;
}

export function speak(text: string, opts: SpeakOptions = {}): void {
  if (!text.trim()) {
    opts.onDone?.();
    return;
  }
  Speech.stop(); // never overlap two utterances
  Speech.speak(text, {
    language: config.locale,
    rate: 1.0,
    pitch: 1.0,
    onDone: opts.onDone,
    onStopped: opts.onDone,
    onError: (e) => opts.onError?.(String(e)),
  });
}

export function stopSpeaking(): void {
  Speech.stop();
}
