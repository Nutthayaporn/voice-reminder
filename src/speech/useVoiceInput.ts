// useVoiceInput — the push-to-talk core.
//
// One tap starts listening, another stops. Internally it drives EITHER the
// cloud engine (record with expo-audio → upload to Groq Whisper) OR the
// on-device engine (expo-speech-recognition), chosen by `engine`. Both funnel
// a final transcript into `onResult`, so the screen (and later "the brain")
// doesn't care which engine produced it.
//
// Rules-of-hooks note: both engines' hooks are always mounted; we branch only
// inside start()/stop(). Native speech-recognition results arrive via events,
// so we keep the latest values in refs to read them from those callbacks.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import {
  useAudioRecorder,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';
import { config } from '../config';
import { transcribeWithGroq } from './cloudGroq';
import {
  getSpeechModule,
  addSpeechListener,
  ensureDeviceSttPermission,
} from './deviceStt';
import { createWebStt, type WebSttSession } from './webStt';
import type { SttEngineId, VoiceStatus, TranscriptResult } from './types';

interface UseVoiceInputArgs {
  engine: SttEngineId;
  onResult: (r: TranscriptResult) => void;
  onError?: (message: string) => void;
}

export function useVoiceInput({ engine, onResult, onError }: UseVoiceInputArgs) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [partial, setPartial] = useState(''); // live text shown while listening

  // Latest values readable from native event callbacks (avoid stale closures).
  const engineRef = useRef(engine);
  engineRef.current = engine;
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const startedAtRef = useRef(0);
  const deviceTextRef = useRef('');
  const webSessionRef = useRef<WebSttSession | null>(null);
  const listeningRef = useRef(false); // guards double stop / stray end events

  const fail = useCallback((message: string) => {
    listeningRef.current = false;
    setStatus('error');
    setPartial('');
    onErrorRef.current?.(message);
  }, []);

  const finish = useCallback((text: string, usedEngine: SttEngineId) => {
    listeningRef.current = false;
    setStatus('idle');
    setPartial('');
    onResultRef.current({
      text: text.trim(),
      engine: usedEngine,
      elapsedMs: Date.now() - startedAtRef.current,
    });
  }, []);

  // ---- on-device engine events ------------------------------------------
  // Subscribe directly to the optional native module (no static package import,
  // so Expo Go stays alive). Subscriptions are no-ops when the module is absent.
  useEffect(() => {
    const subs = [
      addSpeechListener('result', (e: any) => {
        if (engineRef.current !== 'device') return;
        const text = e?.results?.[0]?.transcript ?? '';
        deviceTextRef.current = text;
        setPartial(text);
      }),
      addSpeechListener('error', (e: any) => {
        if (engineRef.current !== 'device' || !listeningRef.current) return;
        fail(e?.message || `speech error: ${e?.error ?? 'unknown'}`);
      }),
      addSpeechListener('end', () => {
        // Final transcript for the device engine lands here.
        if (engineRef.current !== 'device' || !listeningRef.current) return;
        finish(deviceTextRef.current, 'device');
      }),
    ];
    return () => subs.forEach((s) => s?.remove());
  }, [fail, finish]);

  // ---- cloud engine (record → Groq) -------------------------------------
  const startCloud = useCallback(async () => {
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) return fail('Microphone access was not granted.');
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    startedAtRef.current = Date.now();
    listeningRef.current = true;
    setStatus('listening');
  }, [recorder, fail]);

  const stopCloud = useCallback(async () => {
    setStatus('transcribing');
    await recorder.stop();
    const uri = recorder.uri;
    if (!uri) return fail('The recorded audio file could not be found.');
    try {
      const text = await transcribeWithGroq(uri);
      finish(text, 'cloud');
    } catch (e: unknown) {
      fail(e instanceof Error ? e.message : String(e));
    }
  }, [recorder, fail, finish]);

  // ---- device engine ----------------------------------------------------
  const startDevice = useCallback(async () => {
    const granted = await ensureDeviceSttPermission();
    if (!granted) return fail('Speech recognition access was not granted.');
    deviceTextRef.current = '';
    setPartial('');
    startedAtRef.current = Date.now();
    listeningRef.current = true;
    setStatus('listening');
    getSpeechModule()?.start({
      lang: config.locale,
      interimResults: true, // live partial text
      continuous: false, // stop after a natural pause / explicit stop
    });
  }, [fail]);

  const stopDevice = useCallback(async () => {
    // The final result/end event drives finish(); just ask it to wrap up.
    setStatus('transcribing');
    getSpeechModule()?.stop();
  }, []);

  // ---- browser engine (Web Speech API) ---------------------------------
  const startWeb = useCallback(async () => {
    setPartial('');
    startedAtRef.current = Date.now();

    const session = createWebStt(config.locale, {
      onPartial: (text) => {
        if (engineRef.current === 'web' && listeningRef.current) setPartial(text);
      },
      onEnd: (text) => {
        if (engineRef.current !== 'web' || !listeningRef.current) return;
        webSessionRef.current = null;
        finish(text, 'web');
      },
      onError: (message) => {
        if (engineRef.current !== 'web' || !listeningRef.current) return;
        webSessionRef.current = null;
        fail(message);
      },
    });

    if (!session) return fail('This browser does not support Web Speech API.');

    webSessionRef.current = session;
    listeningRef.current = true;
    setStatus('listening');
    try {
      session.start();
    } catch (e: unknown) {
      webSessionRef.current = null;
      fail(e instanceof Error ? e.message : String(e));
    }
  }, [fail, finish]);

  const stopWeb = useCallback(async () => {
    setStatus('transcribing');
    try {
      webSessionRef.current?.stop();
    } catch (e: unknown) {
      webSessionRef.current = null;
      fail(e instanceof Error ? e.message : String(e));
    }
  }, [fail]);

  // ---- public controls --------------------------------------------------
  const start = useCallback(async () => {
    if (listeningRef.current) return;
    if (Platform.OS === 'web') await startWeb();
    else if (engine === 'cloud') await startCloud();
    else await startDevice();
  }, [engine, startCloud, startDevice, startWeb]);

  const stop = useCallback(async () => {
    if (!listeningRef.current) return;
    if (Platform.OS === 'web') await stopWeb();
    else if (engineRef.current === 'cloud') await stopCloud();
    else await stopDevice();
  }, [stopCloud, stopDevice, stopWeb]);

  const toggle = useCallback(() => {
    if (listeningRef.current) void stop();
    else void start();
  }, [start, stop]);

  // Abort any in-flight recognition if the screen goes away.
  useEffect(
    () => () => {
      listeningRef.current = false;
      webSessionRef.current?.abort();
      webSessionRef.current = null;
      try {
        getSpeechModule()?.abort();
      } catch {
        /* native module may be absent in Expo Go */
      }
    },
    [],
  );

  return { status, partial, start, stop, toggle };
}
