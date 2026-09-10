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

const END_OF_SPEECH_SILENCE_MS = 800;
const INITIAL_NO_SPEECH_TIMEOUT_MS = 8_000;
const MAX_UTTERANCE_MS = 45_000;
const CLOUD_METER_INTERVAL_MS = 150;
const CLOUD_NOISE_CALIBRATION_MS = 600;
const CLOUD_SIGNAL_ABOVE_NOISE_DB = 6;
const CLOUD_RECORDING_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  isMeteringEnabled: true,
};

interface UseVoiceInputArgs {
  engine: SttEngineId;
  autoStop?: boolean;
  onResult: (r: TranscriptResult) => void;
  onError?: (message: string) => void;
}

export function useVoiceInput({
  engine,
  autoStop = true,
  onResult,
  onError,
}: UseVoiceInputArgs) {
  const recorder = useAudioRecorder(CLOUD_RECORDING_OPTIONS);
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
  const deviceFinalPartsRef = useRef<string[]>([]);
  const webSessionRef = useRef<WebSttSession | null>(null);
  const listeningRef = useRef(false); // guards double stop / stray end events
  const sessionIdRef = useRef(0);
  const cloudStoppingRef = useRef(false);
  const cloudVoiceStartedRef = useRef(false);
  const cloudLastVoiceAtRef = useRef(0);
  const cloudNoiseFloorRef = useRef<number | null>(null);
  const cloudLoudSamplesRef = useRef(0);
  const webSilenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearWebSilenceTimer = useCallback(() => {
    if (!webSilenceTimerRef.current) return;
    clearTimeout(webSilenceTimerRef.current);
    webSilenceTimerRef.current = null;
  }, []);

  const fail = useCallback((message: string) => {
    listeningRef.current = false;
    setStatus('error');
    setPartial('');
    onErrorRef.current?.(message);
  }, []);

  const finish = useCallback((text: string, usedEngine: SttEngineId) => {
    listeningRef.current = false;
    cloudStoppingRef.current = false;
    clearWebSilenceTimer();
    setStatus('idle');
    setPartial('');
    onResultRef.current({
      text: text.trim(),
      engine: usedEngine,
      elapsedMs: Date.now() - startedAtRef.current,
    });
  }, [clearWebSilenceTimer]);

  // ---- on-device engine events ------------------------------------------
  // Subscribe directly to the optional native module (no static package import,
  // so Expo Go stays alive). Subscriptions are no-ops when the module is absent.
  useEffect(() => {
    const subs = [
      addSpeechListener('result', (e: any) => {
        if (engineRef.current !== 'device') return;
        const text = e?.results?.[0]?.transcript ?? '';
        if (!text) return;
        if (e?.isFinal) {
          deviceFinalPartsRef.current.push(text);
          deviceTextRef.current = deviceFinalPartsRef.current.join(' ').trim();
        } else {
          deviceTextRef.current = [...deviceFinalPartsRef.current, text].join(' ').trim();
        }
        setPartial(deviceTextRef.current);
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
  const startCloud = useCallback(async (sessionId: number) => {
    const perm = await requestRecordingPermissionsAsync();
    if (sessionId !== sessionIdRef.current) return;
    if (!perm.granted) return fail('Microphone access was not granted.');
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    if (sessionId !== sessionIdRef.current) return;
    await recorder.prepareToRecordAsync();
    if (sessionId !== sessionIdRef.current) return;
    cloudStoppingRef.current = false;
    cloudVoiceStartedRef.current = false;
    cloudLastVoiceAtRef.current = 0;
    cloudNoiseFloorRef.current = null;
    cloudLoudSamplesRef.current = 0;
    recorder.record();
    startedAtRef.current = Date.now();
    listeningRef.current = true;
    setStatus('listening');
  }, [recorder, fail]);

  const stopCloud = useCallback(async () => {
    if (cloudStoppingRef.current) return;
    const sessionId = sessionIdRef.current;
    cloudStoppingRef.current = true;
    setStatus('transcribing');
    try {
      await recorder.stop();
      if (sessionId !== sessionIdRef.current) return;
      const uri = recorder.uri;
      if (!uri) return fail('The recorded audio file could not be found.');
      const text = await transcribeWithGroq(uri);
      if (sessionId !== sessionIdRef.current) return;
      finish(text, 'cloud');
    } catch (e: unknown) {
      if (sessionId !== sessionIdRef.current) return;
      fail(e instanceof Error ? e.message : String(e));
    }
  }, [recorder, fail, finish]);

  // ---- device engine ----------------------------------------------------
  const startDevice = useCallback(async (sessionId: number) => {
    const granted = await ensureDeviceSttPermission();
    if (sessionId !== sessionIdRef.current) return;
    if (!granted) return fail('Speech recognition access was not granted.');
    deviceTextRef.current = '';
    deviceFinalPartsRef.current = [];
    setPartial('');
    startedAtRef.current = Date.now();
    listeningRef.current = true;
    setStatus('listening');
    getSpeechModule()?.start({
      lang: config.locale,
      interimResults: true, // live partial text
      continuous: !autoStop,
      ...(autoStop
        ? {
            androidIntentOptions: {
              // Android recognizers may ignore these hints, but supported
              // services use them to match the cloud pause length.
              EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS:
                END_OF_SPEECH_SILENCE_MS,
              EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS:
                END_OF_SPEECH_SILENCE_MS,
            },
          }
        : {}),
    });
  }, [autoStop, fail]);

  const stopDevice = useCallback(async () => {
    // The final result/end event drives finish(); just ask it to wrap up.
    setStatus('transcribing');
    getSpeechModule()?.stop();
  }, []);

  // ---- browser engine (Web Speech API) ---------------------------------
  const startWeb = useCallback(async (_sessionId: number) => {
    setPartial('');
    startedAtRef.current = Date.now();

    const session = createWebStt(config.locale, {
      onPartial: (text) => {
        if (engineRef.current !== 'web' || !listeningRef.current) return;
        setPartial(text);
        if (!autoStop || !text.trim()) return;
        clearWebSilenceTimer();
        webSilenceTimerRef.current = setTimeout(() => {
          if (engineRef.current !== 'web' || !listeningRef.current) return;
          setStatus('transcribing');
          webSessionRef.current?.stop();
        }, END_OF_SPEECH_SILENCE_MS);
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
    }, !autoStop);

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
  }, [autoStop, clearWebSilenceTimer, fail, finish]);

  const stopWeb = useCallback(async () => {
    clearWebSilenceTimer();
    setStatus('transcribing');
    try {
      webSessionRef.current?.stop();
    } catch (e: unknown) {
      webSessionRef.current = null;
      fail(e instanceof Error ? e.message : String(e));
    }
  }, [clearWebSilenceTimer, fail]);

  // ---- public controls --------------------------------------------------
  const start = useCallback(async () => {
    if (listeningRef.current) return;
    const sessionId = ++sessionIdRef.current;
    if (Platform.OS === 'web') await startWeb(sessionId);
    else if (engine === 'cloud') await startCloud(sessionId);
    else await startDevice(sessionId);
  }, [engine, startCloud, startDevice, startWeb]);

  // Permission preflight for auto-listen. The Talk screen calls this before
  // greeting so the system dialog never competes with the assistant's voice.
  const requestPermission = useCallback(async () => {
    if (Platform.OS === 'web' || engine === 'cloud') {
      try {
        const permission = await requestRecordingPermissionsAsync();
        return permission.granted;
      } catch {
        return false;
      }
    }
    return ensureDeviceSttPermission();
  }, [engine]);

  const stop = useCallback(async () => {
    if (!listeningRef.current) return;
    if (Platform.OS === 'web') await stopWeb();
    else if (engineRef.current === 'cloud') await stopCloud();
    else await stopDevice();
  }, [stopCloud, stopDevice, stopWeb]);

  // Cloud Whisper works on a completed audio file, so unlike the streaming
  // engines it needs a small local voice-activity detector to decide when the
  // user has finished. Calibrate a rolling noise floor, require two loud
  // samples to count as speech, then stop after 0.8 seconds of silence.
  useEffect(() => {
    if (!autoStop || engine !== 'cloud' || status !== 'listening') return;
    const timer = setInterval(() => {
      if (!listeningRef.current || cloudStoppingRef.current) return;
      try {
        const recorderStatus = recorder.getStatus();
        const now = Date.now();
        const elapsed = now - startedAtRef.current;
        const metering = recorderStatus.metering;

        if (typeof metering === 'number') {
          const bounded = Math.max(-80, Math.min(-5, metering));
          const floor = cloudNoiseFloorRef.current;
          const calibrating = elapsed < CLOUD_NOISE_CALIBRATION_MS;

          if (calibrating) {
            // A TV or fan may already be audible when recording begins. Treat
            // the quietest early sample as the room floor instead of marking
            // an always-on source as speech before a baseline exists.
            cloudNoiseFloorRef.current = floor == null ? bounded : Math.min(floor, bounded);
            cloudLoudSamplesRef.current = 0;
          } else {
            const threshold =
              floor == null
                ? -35
                : Math.max(-50, Math.min(-8, floor + CLOUD_SIGNAL_ABOVE_NOISE_DB));
            const loud = metering > threshold;

            if (!cloudVoiceStartedRef.current && !loud) {
              cloudNoiseFloorRef.current =
                floor == null ? bounded : floor * 0.92 + bounded * 0.08;
            }

            cloudLoudSamplesRef.current = loud ? cloudLoudSamplesRef.current + 1 : 0;
            if (cloudLoudSamplesRef.current >= 2) {
              cloudVoiceStartedRef.current = true;
              cloudLastVoiceAtRef.current = now;
            }
          }
        }

        const speechEnded =
          cloudVoiceStartedRef.current &&
          now - cloudLastVoiceAtRef.current >= END_OF_SPEECH_SILENCE_MS;
        const noSpeech =
          !cloudVoiceStartedRef.current && elapsed >= INITIAL_NO_SPEECH_TIMEOUT_MS;
        if (speechEnded || noSpeech || elapsed >= MAX_UTTERANCE_MS) void stopCloud();
      } catch {
        // Metering is a convenience; manual stop remains available if a
        // platform temporarily cannot report it.
      }
    }, CLOUD_METER_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [autoStop, engine, recorder, status, stopCloud]);

  const toggle = useCallback(() => {
    if (listeningRef.current) void stop();
    else void start();
  }, [start, stop]);

  const cancel = useCallback(async () => {
    const usedEngine = engineRef.current;
    sessionIdRef.current += 1;
    listeningRef.current = false;
    cloudStoppingRef.current = false;
    clearWebSilenceTimer();
    setPartial('');
    setStatus('idle');
    try {
      if (Platform.OS === 'web') {
        webSessionRef.current?.abort();
        webSessionRef.current = null;
      } else if (usedEngine === 'cloud') {
        const recorderStatus = recorder.getStatus();
        if (recorderStatus.isRecording) await recorder.stop();
      } else {
        getSpeechModule()?.abort();
      }
    } catch {
      // A session may already have ended while cancellation was requested.
    }
  }, [clearWebSilenceTimer, recorder]);

  // Abort any in-flight recognition if the screen goes away.
  useEffect(
    () => () => {
      sessionIdRef.current += 1;
      listeningRef.current = false;
      clearWebSilenceTimer();
      webSessionRef.current?.abort();
      webSessionRef.current = null;
      try {
        getSpeechModule()?.abort();
      } catch {
        /* native module may be absent in Expo Go */
      }
    },
    [clearWebSilenceTimer],
  );

  return { status, partial, start, stop, toggle, cancel, requestPermission };
}
