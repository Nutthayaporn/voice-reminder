// Cloud STT via Groq Whisper.
//
// Groq hosts whisper-large-v3 on a generous free tier and is fast. We upload
// the recorded audio file as multipart/form-data to the OpenAI-compatible
// transcription endpoint and get Thai text back.
//
// SECURITY: the API key is read from config (an EXPO_PUBLIC_ var bundled into
// the app). Fine for a personal prototype; move this whole call server-side
// (Supabase Edge Function) before shipping. See src/config.ts.

import { config } from '../config';

const ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';

/**
 * Transcribe a recorded audio file (local file:// uri from expo-audio).
 * @param uri local recording uri
 * @returns recognised text (may be empty if nothing was said)
 */
export async function transcribeWithGroq(uri: string): Promise<string> {
  if (!config.groqApiKey) {
    throw new Error('ยังไม่ได้ตั้งค่า Groq API key (EXPO_PUBLIC_GROQ_API_KEY)');
  }

  const form = new FormData();
  // React Native's FormData accepts a { uri, name, type } file descriptor.
  form.append('file', {
    uri,
    name: 'speech.m4a',
    type: 'audio/m4a',
  } as unknown as Blob);
  form.append('model', config.groq.sttModel);
  form.append('language', 'th'); // ISO-639-1; steers Whisper toward Thai
  form.append('response_format', 'json');
  form.append('temperature', '0');

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.groqApiKey}`,
      // NOTE: do NOT set Content-Type — fetch sets the multipart boundary.
    },
    body: form,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Groq STT ล้มเหลว (${res.status}) ${detail}`.trim());
  }

  const data = (await res.json()) as { text?: string };
  return (data.text ?? '').trim();
}
