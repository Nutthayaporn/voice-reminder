// Browser STT via the Web Speech API.
//
// SpeechRecognition is still vendor-prefixed in Chrome, so this module keeps
// the small browser-only surface behind our existing speech abstraction. No
// audio file is recorded or uploaded by this provider.

interface RecognitionAlternativeLike {
  transcript: string;
}

interface RecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: RecognitionAlternativeLike;
}

interface RecognitionResultListLike {
  length: number;
  [index: number]: RecognitionResultLike;
}

interface RecognitionEventLike {
  results: RecognitionResultListLike;
}

interface RecognitionErrorEventLike {
  error?: string;
  message?: string;
}

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: RecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognitionConstructor = new () => RecognitionLike;

interface SpeechWindow {
  SpeechRecognition?: RecognitionConstructor;
  webkitSpeechRecognition?: RecognitionConstructor;
}

export interface WebSttCallbacks {
  onPartial: (text: string) => void;
  onEnd: (text: string) => void;
  onError: (message: string) => void;
}

export interface WebSttSession {
  start(): void;
  stop(): void;
  abort(): void;
}

function getConstructor(): RecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const speechWindow = window as unknown as SpeechWindow;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

export function isWebSttAvailable(): boolean {
  return getConstructor() !== null;
}

export function createWebStt(
  locale: string,
  callbacks: WebSttCallbacks,
): WebSttSession | null {
  const Recognition = getConstructor();
  if (!Recognition) return null;

  const recognition = new Recognition();
  let latestText = '';
  let failed = false;

  recognition.lang = locale;
  recognition.interimResults = true;
  recognition.continuous = false;

  recognition.onresult = (event) => {
    const finalParts: string[] = [];
    const interimParts: string[] = [];

    for (let index = 0; index < event.results.length; index += 1) {
      const result = event.results[index];
      const text = result?.[0]?.transcript?.trim();
      if (!text) continue;
      (result.isFinal ? finalParts : interimParts).push(text);
    }

    latestText = [...finalParts, ...interimParts].join(' ').trim();
    callbacks.onPartial(latestText);
  };

  recognition.onerror = (event) => {
    // `aborted` is expected when the component unmounts or the session is reset.
    if (event.error === 'aborted') return;
    failed = true;
    callbacks.onError(
      event.message || `Web Speech API failed (${event.error ?? 'unknown'}).`,
    );
  };

  recognition.onend = () => {
    if (!failed) callbacks.onEnd(latestText);
  };

  return {
    start: () => recognition.start(),
    stop: () => recognition.stop(),
    abort: () => recognition.abort(),
  };
}
