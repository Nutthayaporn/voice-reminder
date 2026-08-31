// The swappable speech contract.
//
// The whole point of Phase 0 is that speech-to-text can come from different
// engines and be swapped at runtime to compare accuracy / latency / cost:
//
//   'cloud'  → record audio, upload to Groq Whisper (very accurate Thai,
//              needs network + an API key, works in Expo Go)
//   'device' → on-device recognition via expo-speech-recognition (free,
//              offline-capable, lower latency, needs a dev build)
//   'web'    → the browser Web Speech API (Chrome/Edge, no audio upload)
//
// Text-to-speech is shared (expo-speech / native OS voice) for now; it is
// modelled as its own piece so a cloud TTS voice can be slotted in later
// without touching callers.

export type SttEngineId = 'cloud' | 'device' | 'web';

export type VoiceStatus =
  | 'idle'
  | 'listening'
  | 'transcribing' // cloud only: audio uploaded, waiting for text
  | 'speaking'
  | 'error';

export interface EngineInfo {
  id: SttEngineId;
  label: string; // shown on the toggle, e.g. "Cloud" / "On-device"
  hint: string; // one-line description of the tradeoff
  /** false when the engine can't run here (missing key / needs dev build). */
  available: boolean;
  /** why it's unavailable, for the UI to surface. */
  unavailableReason?: string;
}

/** A finished transcription plus which engine produced it (for the UI/logs). */
export interface TranscriptResult {
  text: string;
  engine: SttEngineId;
  /** wall-clock ms from stop() to text, useful when comparing engines. */
  elapsedMs: number;
}
