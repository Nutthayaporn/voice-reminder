// App-wide configuration and runtime capability flags.
//
// Secrets come from EXPO_PUBLIC_* env vars. NOTE: anything prefixed with
// EXPO_PUBLIC_ is inlined into the JS bundle and therefore shippable-but-not-
// secret. That's acceptable for a personal prototype; before releasing this,
// Phase 2 should move the Groq call behind a Supabase Edge Function (the same
// pattern daily-budget uses for slip OCR) so the key never leaves the server.

export const config = {
  /** Groq API key — powers cloud STT (Whisper) and, later, the "brain" LLM. */
  groqApiKey: process.env.EXPO_PUBLIC_GROQ_API_KEY ?? '',

  /** Language we recognise / speak. Kept in one place for easy future i18n. */
  locale: 'th-TH',

  /** Groq model ids (free tier). Check availability: GET /openai/v1/models. */
  groq: {
    sttModel: 'whisper-large-v3',
    llmModel: 'openai/gpt-oss-120b', // "the brain" — strong JSON-mode model
  },
} as const;

export function isGroqConfigured(): boolean {
  return config.groqApiKey.length > 0;
}
