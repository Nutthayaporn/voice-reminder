// Cloud STT via Groq Whisper.
//
// Groq hosts whisper-large-v3 on a generous free tier and is fast. We upload
// the recorded audio file to the OpenAI-compatible transcription endpoint and
// get Thai text back.
//
// Upload uses expo-file-system's native multipart uploader rather than JS
// FormData: Expo SDK 54's fetch rejects the RN `{ uri, name, type }` file part
// ("Unsupported FormDataPart implementation"), so we hand the file uri to the
// native side, which builds the multipart body correctly.
//
// SECURITY: the API key is read from config (an EXPO_PUBLIC_ var bundled into
// the app). Fine for a personal prototype; move this whole call server-side
// (Supabase Edge Function) before shipping. See src/config.ts.

import { uploadAsync, FileSystemUploadType } from 'expo-file-system/legacy';
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

  const res = await uploadAsync(ENDPOINT, uri, {
    httpMethod: 'POST',
    uploadType: FileSystemUploadType.MULTIPART,
    fieldName: 'file', // the multipart field Groq expects the audio in
    mimeType: 'audio/m4a',
    parameters: {
      model: config.groq.sttModel,
      language: 'th', // ISO-639-1; steers Whisper toward Thai
      response_format: 'json',
      temperature: '0',
    },
    headers: {
      Authorization: `Bearer ${config.groqApiKey}`,
    },
  });

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Groq STT ล้มเหลว (${res.status}) ${res.body ?? ''}`.trim());
  }

  const data = JSON.parse(res.body || '{}') as { text?: string };
  return (data.text ?? '').trim();
}
