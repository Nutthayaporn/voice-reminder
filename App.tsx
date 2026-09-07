import { CalendarConnectionsPanel, CalendarSyncNotice, ExternalEventRow } from './src/components/CalendarConnectionsPanel';
import { activateCalendars, ensureCalendarRange, externalItems, refreshCalendars, useCalendars } from './src/integrations/calendar/store';
import { defaultRange } from './src/integrations/calendar/model';
import { WebPushPanel } from './src/components/WebPushPanel';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Reanimated, {
  Easing as ReanimatedEasing,
  Extrapolation,
  LinearTransition,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { colors, font, radius, spacing } from './src/theme';
import { config, isGroqConfigured, isBudgetApiConfigured } from './src/config';
import { getEngines } from './src/speech/engines';
import { useVoiceInput } from './src/speech/useVoiceInput';
import { speak, stopSpeaking } from './src/speech/tts';
import type { SttEngineId, TranscriptResult, VoiceStatus } from './src/speech/types';
import { planActions } from './src/brain/planActions';
import { actionToItem } from './src/brain/toItem';
import { searchMemory } from './src/brain/searchMemory';
import { describeAction, toolLabel, formatDateTime, formatRecurrence } from './src/brain/format';
import type { BrainPlan, BrainContext, Referent, SnoozeMinutes } from './src/brain/types';
import { useStore } from './src/store/useStore';
import { answerQuery, queryItems } from './src/store/query';
import type { Item } from './src/store/types';
import { initNotifications, ensureNotifyPermission } from './src/notify/setup';
import { scheduleForItem, cancelNotifications } from './src/notify/scheduler';
import { consumeCompletedNativeAlarmItemIds } from './src/notify/nativeAlarm';
import { sendExpenseToDailyBudget } from './src/integrations/dailyBudget';
import {
  fetchBudgetSummary,
  listExpenses,
  addExpense,
  updateExpense,
  deleteExpense,
  formatBudgetAnswer,
  isBudgetReady,
  type BudgetKind,
  type BudgetTransaction,
} from './src/integrations/budgetApi';
import {
  connect as connectBudget,
  disconnect as disconnectBudget,
  isConnected as isBudgetConnected,
} from './src/integrations/budgetOAuth';
import { bkkDateStr } from './src/lib/date';
import { CalendarMonth } from './src/components/CalendarMonth';
import { CloudSyncPanel } from './src/components/CloudSyncPanel';
import { PersonalDefaultsPanel } from './src/components/PersonalDefaultsPanel';
import { ItemActionsPanel } from './src/components/ItemActionsPanel';
import { assignmentPatch } from './src/domain/assignment';
import { dateKey, occurrencePatch, occursOn } from './src/domain/recurrence';
import { busySlots, freeSlots } from './src/domain/availability';
import { changeDefaults, initialDefaults, replyLanguage } from './src/domain/defaults';
import { localizeReply } from './src/i18n/replies';
import { KnowledgePanel } from './src/components/KnowledgePanel';
import { shoppingDuplicate } from './src/store/planning';
import { linkedChildren, validatePlanLinks } from './src/store/linkedItems';
import { entityContext, validateEntityLinks } from './src/knowledge/entities';
import { CapabilityGuide } from './src/components/CapabilityGuide';
import { capabilityAnswer, isHelpQuestion } from './src/help/capabilities';
import { SpacePicker } from './src/components/SpacePicker';
import { useSpaces } from './src/spaces/useSpaces';
import { itemsInSpace, resolveSpace, spaceLabel } from './src/spaces/routing';
import { HouseholdPanel } from './src/components/HouseholdPanel';
import { EditItemModal, type ItemEditPatch } from './src/components/EditItemModal';
import { usePreferences } from './src/store/usePreferences';
import { planLocalDelete } from './src/brain/localDelete';
import {
  deleteScopeLabel,
  isDeleteCancellation,
  isDeleteConfirmation,
  itemsForDeleteScope,
  resolveDeleteTarget,
} from './src/store/delete';
import {
  clearPendingHouseholdInvite,
  inviteCodeFromUrl,
  loadPendingHouseholdInvite,
  savePendingHouseholdInvite,
} from './src/sharing/householdInvite';

const HUD_HORIZONTAL_LINES = [86, 172, 258, 344, 430, 516, 602, 688] as const;
const HUD_VERTICAL_LINES = [44, 132, 220, 308] as const;
const HUD_PARTICLES = [
  { top: 74, left: 28 },
  { top: 158, right: 34 },
  { top: 326, left: 18 },
  { top: 548, right: 24 },
] as const;
const CORE_TICKS = Array.from({ length: 24 }, (_, index) => index);
const WAVEFORM_HEIGHTS = [4, 9, 14, 7, 12, 5, 10] as const;
type AppTab = 'talk' | 'items' | 'calendar' | 'settings';
interface PendingBulkDelete {
  itemIds: string[];
  description: string;
  userId: string | null;
  scopes: Record<string, string | null>;
}

export default function App() {
  return (
    <GestureHandlerRootView style={styles.gestureRoot}>
      <VoiceReminderApp />
    </GestureHandlerRootView>
  );
}

function VoiceReminderApp() {
  const engines = useMemo(() => getEngines(), []);
  const preferredEngine = usePreferences((state) => state.preferredEngine);
  const setPreferredEngine = usePreferences((state) => state.setPreferredEngine);
  const handsFreeEnabled = usePreferences((state) => state.handsFreeEnabled);
  const setHandsFreeEnabled = usePreferences((state) => state.setHandsFreeEnabled);
  const autoStopEnabled = usePreferences((state) => state.autoStopEnabled);
  const setAutoStopEnabled = usePreferences((state) => state.setAutoStopEnabled);
  const defaultAlertMode = usePreferences((state) => state.defaultAlertMode);
  const setDefaultAlertMode = usePreferences((state) => state.setDefaultAlertMode);
  const activeHouseholdId = usePreferences((state) => state.activeHouseholdId);
  const firstAvailable =
    engines.find((candidate) => candidate.id === preferredEngine && candidate.available)?.id ??
    engines.find((candidate) => candidate.available)?.id ??
    engines[0]?.id ??
    'cloud';
  const [engine, setEngine] = useState<SttEngineId>(firstAvailable);
  const [activeTab, setActiveTab] = useState<AppTab>('talk');
  const [selectedDate, setSelectedDate] = useState<string>(() => bkkDateStr());
  const [last, setLast] = useState<TranscriptResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [handsFreePaused, setHandsFreePaused] = useState(false);
  const [appIsActive, setAppIsActive] = useState(AppState.currentState === 'active');
  const [plan, setPlan] = useState<BrainPlan | null>(null);
  const [budgetConnected, setBudgetConnected] = useState(false);
  const helpOptions = { web: Platform.OS === 'web', budget: budgetConnected || (isBudgetApiConfigured() && !!config.budgetApi.token), shared: !!useStore((state) => state.userId) };
  const helpOptionsRef = useRef(helpOptions);
  helpOptionsRef.current = helpOptions;
  const [budgetBusy, setBudgetBusy] = useState(false);
  const [pendingHouseholdInviteCode, setPendingHouseholdInviteCode] = useState<string | null>(null);
  const [memorySources, setMemorySources] = useState<Item[]>([]);
  const languageRef = useRef<'th' | 'en'>('th');
  const conflictRef = useRef<{ plan: BrainPlan; text: string; userId: string | null; space: string | null } | null>(null);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Item | null>(null);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingBulkDeleteRef = useRef<PendingBulkDelete | null>(null);
  const startListeningRef = useRef<() => Promise<void>>(async () => {});
  const cancelListeningRef = useRef<() => Promise<void>>(async () => {});
  const voiceStatusRef = useRef<VoiceStatus>('idle');
  const responseTokenRef = useRef(0);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const talkWasEligibleRef = useRef(false);
  const hasGreetedRef = useRef(false);
  const wasOnTalkRef = useRef(activeTab === 'talk' && appIsActive);
  const handsFreeEnabledRef = useRef(handsFreeEnabled);
  const activeTabRef = useRef<AppTab>(activeTab);
  const appIsActiveRef = useRef(appIsActive);
  const thinkingRef = useRef(thinking);
  const speakingRef = useRef(speaking);
  const handsFreePausedRef = useRef(handsFreePaused);
  const pendingHouseholdInviteCodeRef = useRef<string | null>(null);

  handsFreeEnabledRef.current = handsFreeEnabled;
  activeTabRef.current = activeTab;
  appIsActiveRef.current = appIsActive;
  thinkingRef.current = thinking;
  speakingRef.current = speaking;
  handsFreePausedRef.current = handsFreePaused;

  const rememberHouseholdInvite = useCallback((inviteCode: string) => {
    pendingHouseholdInviteCodeRef.current = inviteCode;
    setPendingHouseholdInviteCode(inviteCode);
    setActiveTab('settings');
    void savePendingHouseholdInvite(inviteCode).catch(() => undefined);
  }, []);

  const dismissHouseholdInvite = useCallback(() => {
    pendingHouseholdInviteCodeRef.current = null;
    setPendingHouseholdInviteCode(null);
    void clearPendingHouseholdInvite().catch(() => undefined);
  }, []);

  useEffect(() => {
    let mounted = true;

    // getInitialURL covers a cold start; the subscription covers links tapped
    // while VORA is already running. Persisted state lets sign-in complete in
    // a browser/app round trip without losing the invitation.
    void Promise.all([Linking.getInitialURL(), loadPendingHouseholdInvite()])
      .then(([initialUrl, storedInvite]) => {
        if (!mounted || pendingHouseholdInviteCodeRef.current) return;
        const inviteFromUrl = initialUrl ? inviteCodeFromUrl(initialUrl) : null;
        const inviteCode = inviteFromUrl ?? storedInvite;
        if (inviteCode) rememberHouseholdInvite(inviteCode);
      })
      .catch(() => undefined);

    const subscription = Linking.addEventListener('url', ({ url }) => {
      const inviteCode = inviteCodeFromUrl(url);
      if (inviteCode) rememberHouseholdInvite(inviteCode);
    });

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, [rememberHouseholdInvite]);

  const items = useStore((state) => state.items);
  const userId = useStore((state) => state.userId);
  const calendarEvents = useCalendars((state) => state.events);
  useEffect(() => {
    void activateCalendars(userId);
    if (Platform.OS === 'web' && new URL(window.location.href).searchParams.has('calendar_result')) setActiveTab('settings');
    const refresh = () => { void refreshCalendars(); };
    const listener = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    const interval = setInterval(() => { if (AppState.currentState === 'active') refresh(); }, 5 * 60000);
    return () => { listener.remove(); clearInterval(interval); };
  }, [userId]);
  useEffect(() => { void useSpaces.getState().refresh().catch(() => {}); }, [userId, appIsActive]);
  const hasHydrated = useStore((state) => state.hasHydrated);
  const addItem = useStore((state) => state.addItem);
  const removeItem = useStore((state) => state.removeItem);
  const updateItem = useStore((state) => state.updateItem);
  const bootstrapSync = useStore((state) => state.bootstrapSync);

  // Short-lived conversation memory: what the user can refer to next turn
  // ("อันแรก" / "อันเมื่อกี้") + a pending utterance awaiting clarification.
  const contextRef = useRef<BrainContext>({ referents: [] });
  // The id of the last expense we logged to daily-budget this session, so
  // "แก้เมื่อกี้เป็น 60" / "ลบอันเมื่อกี้" can target it (expense_ref="last").
  const lastExpenseIdRef = useRef<string | null>(null);
  useEffect(() => {
    contextRef.current = { referents: [] };
    usePreferences.getState().setActiveHouseholdId(null);
    pendingBulkDeleteRef.current = null;
    lastExpenseIdRef.current = null;
  }, [userId]);
  useEffect(() => {
    contextRef.current = { ...contextRef.current, referents: [] };
    pendingBulkDeleteRef.current = null;
  }, [activeHouseholdId]);

  const scheduleListeningStart = useCallback(
    (delayMs = 300, allowWithoutHandsFree = false) => {
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
      const responseToken = responseTokenRef.current;
      const tryResume = () => {
        if (
          responseToken !== responseTokenRef.current ||
          (!allowWithoutHandsFree && !handsFreeEnabledRef.current) ||
          activeTabRef.current !== 'talk' ||
          !appIsActiveRef.current ||
          handsFreePausedRef.current
        ) {
          return;
        }
        if (thinkingRef.current || speakingRef.current) {
          resumeTimerRef.current = setTimeout(tryResume, 150);
          return;
        }
        if (voiceStatusRef.current === 'idle' || voiceStatusRef.current === 'error') {
          void startListeningRef.current();
        }
      };
      resumeTimerRef.current = setTimeout(tryResume, delayMs);
    },
    [],
  );

  // The Talk greeting always opens the microphone once. Later replies only
  // reopen it when the independent Hands-free preference is enabled.
  const say = useCallback(
    (text: string, language?: string, listenAfter = false) => {
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
      const responseToken = ++responseTokenRef.current;
      speakingRef.current = true;
      setSpeaking(true);

      const finish = (completed: boolean) => {
        if (responseToken !== responseTokenRef.current) return;
        speakingRef.current = false;
        setSpeaking(false);
        if (completed && (listenAfter || handsFreeEnabledRef.current)) {
          scheduleListeningStart(300, listenAfter);
        }
      };

      speak(language ? text : localizeReply(text, languageRef.current), {
        language: language ?? (languageRef.current === 'th' ? 'th-TH' : 'en-US'),
        onDone: () => finish(true),
        onStopped: () => finish(false),
        // TTS is an enhancement; if a platform has no matching voice, keep
        // the requested flow moving without showing a processing error.
        onError: () => finish(true),
      });
    },
    [scheduleListeningStart],
  );

  const toggleHandsFree = useCallback(() => {
    const enabled = !handsFreeEnabledRef.current;
    handsFreeEnabledRef.current = enabled;
    handsFreePausedRef.current = false;
    setHandsFreePaused(false);
    if (enabled) {
      scheduleListeningStart(100);
    } else {
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
      void cancelListeningRef.current();
    }
    setHandsFreeEnabled(enabled);
  }, [scheduleListeningStart, setHandsFreeEnabled]);

  useEffect(() => {
    if (!preferredEngine) return;
    const preferred = engines.find(
      (candidate) => candidate.id === preferredEngine && candidate.available,
    );
    if (preferred) setEngine(preferred.id);
  }, [engines, preferredEngine]);

  useEffect(
    () => () => {
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (Platform.OS !== 'web' || !hasHydrated || typeof window === 'undefined') return;
    const target = new URL(window.location.href).searchParams.get('item');
    const item = items.find((candidate) => candidate.id === target);
    if (item) { setEditingItem(item); const url = new URL(window.location.href); url.searchParams.delete('item'); window.history.replaceState(null, '', url.href); }
  }, [hasHydrated, items]);

  const syncNativeCompletions = useCallback(async () => {
    const completedIds = await consumeCompletedNativeAlarmItemIds();
    for (const completedId of completedIds) {
      const [id, occurrence] = completedId.split('~');
      const item = useStore.getState().items.find((candidate) => candidate.id === id);
      if (!item || item.done) continue;
      const patch = item.recurrence ? occurrencePatch(item, dateKey(occurrence ?? new Date()), 'done') : { done: true };
      await cancelNotifications(item.notificationIds);
      await updateItem(item.id, { ...patch, notificationIds: await scheduleForItem({ ...item, ...patch }) });
    }
    // Exception-based series use a rolling queue; replenish it whenever the app
    // resumes, keeping notification IDs device-local (no artificial cloud edit).
    for (const item of useStore.getState().items) {
      if (!item.recurrence || item.done || (!Object.keys(item.details?.occurrences ?? {}).length && item.recurrence.interval <= 1)) continue;
      await cancelNotifications(item.notificationIds);
      const notificationIds = await scheduleForItem(item);
      const current = useStore.getState().items.find((candidate) => candidate.id === item.id);
      if (current?.updated_at === item.updated_at) useStore.setState((state) => ({ items: state.items.map((candidate) => candidate.id === item.id ? { ...candidate, notificationIds } : candidate) }));
      else await cancelNotifications(notificationIds);
    }
  }, [updateItem]);

  useEffect(() => {
    void initNotifications();
    void syncNativeCompletions();
    const subscription = AppState.addEventListener('change', (state) => {
      const active = state === 'active';
      appIsActiveRef.current = active;
      setAppIsActive(active);
      if (active) {
        void syncNativeCompletions();
      }
    });
    return () => subscription.remove();
  }, [syncNativeCompletions]);

  useEffect(() => {
    if (hasHydrated) { void bootstrapSync(); void syncNativeCompletions(); }
  }, [bootstrapSync, hasHydrated, syncNativeCompletions]);

  // Daily Budget account link (OAuth). Reflects whether this device holds a
  // valid grant; the connect flow hands off to the daily-budget app and back.
  const refreshBudgetConnection = useCallback(async () => {
    setBudgetConnected(await isBudgetConnected());
  }, []);

  useEffect(() => {
    void refreshBudgetConnection();
  }, [refreshBudgetConnection]);

  const handleConnectBudget = useCallback(async () => {
    setBudgetBusy(true);
    const res = await connectBudget();
    setBudgetBusy(false);
    await refreshBudgetConnection();
    if (res.ok) {
      speak('Daily Budget connected.');
    } else if (res.reason === 'provider_missing') {
      setError('Daily Budget app not found. Please install it to connect.');
    } else if (res.reason && res.reason !== 'access_denied' && res.reason !== 'timeout') {
      setError(`Could not connect Daily Budget: ${res.reason}`);
    }
  }, [refreshBudgetConnection]);

  const handleDisconnectBudget = useCallback(async () => {
    setBudgetBusy(true);
    await disconnectBudget();
    setBudgetBusy(false);
    await refreshBudgetConnection();
    speak('Daily Budget disconnected.');
  }, [refreshBudgetConnection]);

  // Apply an update_item action; reschedule notifications if the timing changed.
  const applyUpdate = useCallback(
    async (target: Item, action: BrainPlan['actions'][number]) => {
      const patch: Partial<Item> = {};
      if (action.datetime) patch.start_at = action.datetime;
      if (action.end_datetime) patch.end_at = action.end_datetime;
      if (action.recurrence) patch.recurrence = action.recurrence;
      if (action.alert_mode) {
        patch.alert_mode = action.alert_mode;
        // Choosing a delivery mode explicitly means ordinary one-shot alarm
        // unless the same action explicitly opts into Until Done below.
        if (action.remind_until_done == null) patch.remind_until_done = false;
      }
      if (action.remind_until_done != null) {
        patch.remind_until_done = action.remind_until_done;
        if (action.remind_until_done) patch.alert_mode = 'alarm';
      }
      if (action.snooze_minutes) patch.snooze_minutes = action.snooze_minutes;
      if (action.max_attempts) patch.max_attempts = action.max_attempts;
      if (action.done != null) {
        if (target.recurrence) Object.assign(patch, occurrencePatch(target, dateKey(new Date()), action.done ? 'done' : 'pending'));
        else patch.done = action.done;
      }

      const timingChanged =
        patch.start_at !== undefined ||
        patch.recurrence !== undefined ||
        patch.alert_mode !== undefined ||
        patch.remind_until_done !== undefined ||
        patch.snooze_minutes !== undefined ||
        patch.max_attempts !== undefined ||
        patch.done !== undefined || patch.details !== undefined;
      if (timingChanged) {
        await cancelNotifications(target.notificationIds);
        patch.notificationIds = await scheduleForItem({ ...target, ...patch });
      }
      await updateItem(target.id, patch);
    },
    [updateItem],
  );

  // Carry out every action in a plan, then speak one reply.
  const executePlan = useCallback(
    async (p: BrainPlan, rawText: string, allowConflicts = false) => {
      const CREATE_TOOLS = ['create_reminder', 'create_event', 'create_todo', 'create_note', 'remember_entity', 'add_shopping'];
      const executionUser = useStore.getState().userId;
      const available = executionUser ? await useSpaces.getState().refresh().catch(() => []) : [];
      if (useStore.getState().userId !== executionUser) throw new Error('Account changed. Please try again.');
      const selected = executionUser ? usePreferences.getState().activeHouseholdId : null;
      const scope = (action: BrainPlan['actions'][number]) => resolveSpace(action, selected, available);
      const snapshot = () => useStore.getState().items;
      const scoped = (action: BrainPlan['actions'][number]) => itemsInSpace(snapshot(), scope(action));
      const calendarActions = p.actions.filter(a => ((a.tool === 'query' && a.query_kind !== 'search' && a.query_kind !== 'shopping' && a.query_kind !== 'overdue') || a.tool === 'find_free_time' || a.tool === 'create_event' || (a.tool === 'update_item' && a.datetime)) && !scope(a));
      if (calendarActions.length) {
        const dates = calendarActions.flatMap(a => [a.datetime, a.end_datetime]).filter((d): d is string => !!d).map(d => Date.parse(d)).filter(Number.isFinite);
        const start = dates.length ? Math.min(...dates) : Date.now();
        const end = dates.length ? Math.max(...dates) : Date.now();
        await ensureCalendarRange(executionUser, new Date(start - 86400000).toISOString(), new Date(end + 2 * 86400000).toISOString());
        if (useStore.getState().userId !== executionUser) throw new Error('Account changed. Please try again.');
      }
      const readable = (action: BrainPlan['actions'][number]) => [...scoped(action), ...externalItems(executionUser, scope(action))];
      validatePlanLinks(p.actions, snapshot(), scope);
      if (p.actions.some(a => ['update_item', 'delete_item', 'share_item', 'assign_item', 'set_occurrence', 'link_reminder'].includes(a.tool) && a.target_ref?.startsWith('external:'))) {
        throw new Error(languageRef.current === 'th' ? 'นัดจากปฏิทินที่เชื่อมต่ออ่านได้อย่างเดียว กรุณาแก้ไขในแอปปฏิทินต้นทาง' : 'Connected calendar events are read only. Edit them in the original calendar app.');
      }
      // Validate every local action before any side effects.
      for (const action of p.actions) {
        if (CREATE_TOOLS.includes(action.tool) || ['query', 'update_item', 'delete_item', 'share_item', 'assign_item', 'set_occurrence', 'find_free_time'].includes(action.tool)) {
          scope(action);
          validateEntityLinks(action.entity_refs, scope(action), snapshot());
          if (action.tool === 'remember_entity') {
            if (!action.entity_kind) throw new Error('Please specify person, pet or place.');
            const matches = scoped(action).filter((item) => item.details?.profile && (action.target_ref ? item.id === action.target_ref : item.title.trim().toLocaleLowerCase() === action.title.trim().toLocaleLowerCase()));
            if (matches.length > 1 || (action.target_ref && !matches.length)) throw new Error('Please choose the person, pet or place in Settings first.');
          }
          if (action.tool === 'share_item' && (!scope(action) || !snapshot().some((item) => item.id === action.target_ref && !item.household_id))) {
            throw new Error('Choose a personal item and a shared destination first.');
          }
          if (['update_item', 'delete_item', 'assign_item', 'set_occurrence'].includes(action.tool) && !scoped(action).some((item) => item.id === action.target_ref)) {
            throw new Error('The item is not in the requested space. Select its space and try again.');
          }
        }
      }
      const created: Item[] = [];
      let requestedSingleDeletes = 0;
      let completedSingleDeletes = 0;

      // ── daily-budget REST helpers (see src/integrations/budgetApi.ts) ──────
      const money = (n: number) => Math.round(n).toLocaleString('en-US');

      const answerBudgetQuery = async (kind: BudgetKind | null): Promise<string> => {
        if (!(await isBudgetReady())) {
          return 'Please connect your Daily Budget account in settings first.';
        }
        try {
          const summary = await fetchBudgetSummary();
          return formatBudgetAnswer(summary, kind ?? 'summary', languageRef.current);
        } catch {
          return 'I could not reach Daily Budget. Please check the connection or that cloud sync is on.';
        }
      };

      const recordExpenseViaApi = async (
        action: BrainPlan['actions'][number],
      ): Promise<string> => {
        try {
          const tx = await addExpense({
            amount: action.amount as number,
            note: action.title || undefined,
            date: bkkDateStr(action.datetime ?? new Date()),
          });
          lastExpenseIdRef.current = tx.id;
          return `Logged ${money(tx.amount)} baht${tx.note ? ` for ${tx.note}` : ''}.`;
        } catch {
          return 'I could not save that expense to Daily Budget.';
        }
      };

      // Resolve which logged expense an edit/delete refers to: the one we just
      // added ("เมื่อกี้"), a note match, an amount match, else the most recent.
      const findExpenseTarget = async (
        action: BrainPlan['actions'][number],
      ): Promise<BudgetTransaction | null> => {
        let recent: BudgetTransaction[];
        try {
          recent = await listExpenses({ limit: 20 });
        } catch {
          return null;
        }
        const expenses = recent.filter((t) => t.type === 'expense');
        if (action.expense_ref === 'last') {
          return expenses.find((t) => t.id === lastExpenseIdRef.current) ?? expenses[0] ?? null;
        }
        const title = (action.title || '').trim().toLowerCase();
        if (title) {
          const byNote = expenses.find((t) => (t.note ?? '').toLowerCase().includes(title));
          if (byNote) return byNote;
        }
        if (action.tool === 'delete_expense' && action.amount != null) {
          const byAmount = expenses.find((t) => t.amount === action.amount);
          if (byAmount) return byAmount;
        }
        return expenses[0] ?? null;
      };

      const editExpenseViaApi = async (
        action: BrainPlan['actions'][number],
      ): Promise<string> => {
        if (!(await isBudgetReady())) {
          return 'Please connect your Daily Budget account in settings first.';
        }
        const target = await findExpenseTarget(action);
        if (!target) {
          return action.tool === 'delete_expense'
            ? 'I could not find that expense to delete.'
            : 'I could not find that expense to edit.';
        }
        try {
          if (action.tool === 'delete_expense') {
            await deleteExpense(target.id);
            if (lastExpenseIdRef.current === target.id) lastExpenseIdRef.current = null;
            return `Deleted the ${money(target.amount)} baht expense${
              target.note ? ` for ${target.note}` : ''
            }.`;
          }
          const tx = await updateExpense({
            id: target.id,
            amount: action.amount ?? undefined,
            note: action.title || undefined,
            date: action.datetime ? bkkDateStr(action.datetime) : undefined,
          });
          lastExpenseIdRef.current = tx.id;
          return `Updated to ${money(tx.amount)} baht.`;
        } catch {
          return action.tool === 'delete_expense'
            ? 'I could not delete that expense.'
            : 'I could not update that expense.';
        }
      };

      for (const action of p.actions) {
        if (action.tool === 'assign_item') {
          const target = scoped(action).find((item) => item.id === action.target_ref)!;
          assignmentPatch(target, action.assignee_id, action.notify_user_ids, available.find((space) => space.id === scope(action))?.members ?? []);
        }
        if (action.tool === 'set_occurrence') occurrencePatch(scoped(action).find((item) => item.id === action.target_ref)!, action.occurrence_date ?? dateKey(new Date()), action.occurrence_status ?? 'done');
        if (action.tool === 'find_free_time') freeSlots(readable(action), new Date(action.datetime ?? ''), new Date(action.end_datetime ?? ''), action.duration_minutes ?? 60);
        if (action.tool === 'set_preference') changeDefaults(usePreferences.getState().personalDefaults[executionUser ?? 'local'] ?? initialDefaults, action.preference_key ?? '', action.preference_value ?? null);
        if (!allowConflicts && (action.tool === 'create_event' || action.tool === 'update_item') && action.datetime) {
          const target = action.tool === 'update_item' ? scoped(action).find((item) => item.id === action.target_ref) : null;
          if (target && target.type !== 'event') continue;
          const from = new Date(action.datetime), until = action.end_datetime ? new Date(action.end_datetime) : new Date(from.getTime() + (action.all_day ? 86400000 : 3600000));
          if (busySlots(readable(action).filter((item) => item.id !== target?.id), from, until).length) {
            conflictRef.current = { plan: p, text: rawText, userId: executionUser, space: selected };
            const alternative = freeSlots(readable(action).filter((item) => item.id !== target?.id), from, new Date(from.getTime() + 86400000), (until.getTime() - from.getTime()) / 60000)[0];
            const label = alternative ? new Intl.DateTimeFormat(languageRef.current === 'th' ? 'th-TH' : 'en-US', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(alternative.start)) : '';
            const question = languageRef.current === 'th' ? `เวลานี้มีนัดอยู่แล้ว ${label ? `ช่วงว่างถัดไปเริ่ม ${label} ` : ''}พูดยืนยันเพื่อนัดซ้อน หรือบอกเวลาใหม่` : `This overlaps an event. ${label ? `The next free slot starts ${label}. ` : ''}Say confirm to keep the overlap, or choose a different time.`;
            setPlan({ ...p, actions: [], speak_back: question, needs_clarification: true, clarify_question: question }); say(question); return;
          }
        }
      }
      const needsPerm = p.actions.some(
        (a) => CREATE_TOOLS.includes(a.tool) || a.tool === 'update_item',
      );
      if (needsPerm) await ensureNotifyPermission();

      const createdByAction = new Map<number, Item>();
      for (const [actionIndex, action] of p.actions.entries()) {
        if (CREATE_TOOLS.includes(action.tool)) {
          const item = actionToItem(
            action,
            scope(action) ? [action.title, action.body].filter(Boolean).join(". ") : rawText,
            defaultAlertMode,
            scope(action),
          ); // keep the verbatim sentence
          if (!item) continue;
          if (action.parent_ref) {
            const actionMatch = action.parent_ref.match(/^action:(\d+)$/);
            const parent = actionMatch ? createdByAction.get(Number(actionMatch[1]) - 1) : snapshot().find((item) => item.id === action.parent_ref);
            if (!parent || !['event', 'todo'].includes(parent.type) || !parent.start_at || !item.start_at || (parent.household_id ?? null) !== scope(action)) throw new Error('The reminder needs a dated event or task in the same space.');
            item.details = { ...item.details, parent_id: parent.id, reminder_offset_minutes: (Date.parse(item.start_at) - Date.parse(parent.start_at)) / 60000 };
          }
          const ids = await scheduleForItem(item);
          const saved = { ...item, notificationIds: ids };
          const existingProfiles = action.tool === 'remember_entity'
            ? scoped(action).filter((candidate) => candidate.details?.profile && (action.target_ref ? candidate.id === action.target_ref : candidate.title.trim().toLocaleLowerCase() === action.title.trim().toLocaleLowerCase()))
            : [];
          if (existingProfiles.length > 1) throw new Error('More than one profile has this name. Edit it in Settings.');
          if (existingProfiles[0]) {
            const existing = existingProfiles[0];
            saved.id = existing.id;
            saved.created_at = existing.created_at;
            saved.body = action.body ?? existing.body;
            saved.details = { ...existing.details, ...saved.details };
            await updateItem(existing.id, saved);
          } else {
            const duplicate = shoppingDuplicate(scoped(action), saved);
            if (duplicate) {
              saved.id = duplicate.id;
              saved.created_at = duplicate.created_at;
              saved.details = { ...duplicate.details, shopping: { ...saved.details!.shopping!, quantity: duplicate.details!.shopping!.quantity + saved.details!.shopping!.quantity } };
              await updateItem(duplicate.id, saved);
            } else addItem(saved);
          }
          if (action.tool === 'remember_entity' && action.aliases) usePreferences.getState().setEntityAliases(executionUser ?? 'local', saved.id, action.aliases);
          created.push(saved);
          createdByAction.set(actionIndex, saved);
        } else if (action.tool === 'set_preference') {
          const owner = executionUser ?? 'local';
          usePreferences.getState().setPersonalDefaults(owner, changeDefaults(usePreferences.getState().personalDefaults[owner] ?? initialDefaults, action.preference_key!, action.preference_value ?? null));
          languageRef.current = replyLanguage(usePreferences.getState().personalDefaults[owner].responseLanguage, rawText);
        } else if (action.tool === 'assign_item' || action.tool === 'set_occurrence') {
          const target = scoped(action).find((item) => item.id === action.target_ref)!;
          const patch = action.tool === 'assign_item' ? assignmentPatch(target, action.assignee_id, action.notify_user_ids, available.find((space) => space.id === scope(action))?.members ?? []) : occurrencePatch(target, action.occurrence_date ?? dateKey(new Date()), action.occurrence_status ?? 'done');
          await cancelNotifications(target.notificationIds);
          const notificationIds = await scheduleForItem({ ...target, ...patch });
          await updateItem(target.id, { ...patch, notificationIds });
        } else if (action.tool === 'share_item') {
          const target = snapshot().find((item) => item.id === action.target_ref && !item.household_id);
          if (!target) throw new Error('That personal item is no longer available.');
          await updateItem(target.id, { household_id: scope(action), raw_text: [target.title, target.body].filter(Boolean).join('. '), details: { ...target.details, entity_ids: [], parent_id: undefined, reminder_offset_minutes: undefined } });
        } else if (action.tool === 'delete_item') {
          requestedSingleDeletes += 1;
          const target = scoped(action).find((i) => i.id === action.target_ref);
          if (target) {
            await cancelNotifications(target.notificationIds);
            removeItem(target.id);
            completedSingleDeletes += 1;
          }
        } else if (action.tool === 'update_item') {
          const target = scoped(action).find((i) => i.id === action.target_ref);
          if (target) await applyUpdate(target, action);
        }
      }

      // Query answer is data-driven → wins over the plan's canned reply.
      const queryAction = p.actions.find((a) => a.tool === 'query');
      let answer = p.actions.some((action) => action.tool === 'help') ? capabilityAnswer(helpOptionsRef.current, languageRef.current) : p.speak_back;
      if (requestedSingleDeletes > 0 && completedSingleDeletes === 0) {
        answer = 'I could not find that item. Try saying its name or list your items first.';
      } else if (completedSingleDeletes > 0) {
        answer = `Deleted ${completedSingleDeletes} ${completedSingleDeletes === 1 ? 'item' : 'items'}.`;
      }
      if (queryAction) {
        if (queryAction.query_kind === 'search') {
          const result = await searchMemory(queryAction.title || rawText, scoped(queryAction), languageRef.current);
          if (useStore.getState().userId !== executionUser) throw new Error('Account changed. Please ask again.');
          answer = result.answer; setMemorySources(result.sources);
        } else answer = answerQuery(readable(queryAction), queryAction, new Date(), languageRef.current);
      }

      // ── daily-budget actions (REST bridge) ────────────────────────────────
      // Budget answers and expense confirmations are data-driven, so they
      // override the plan's canned speak_back. A deep-link handoff (record
      // only, when the API isn't configured) is deferred until after we speak,
      // because it backgrounds this app.
      let deferredDeepLinkExpense: BrainPlan['actions'][number] | null = null;

      const budgetQuery = p.actions.find((a) => a.tool === 'query_budget');
      if (budgetQuery) {
        const budgetAnswer = await answerBudgetQuery(budgetQuery.budget_kind);
        answer = queryAction ? `${answer} ${budgetAnswer}` : budgetAnswer;
      }

      const expense = p.actions.find((a) => a.tool === 'record_expense' && a.amount != null);
      if (expense) {
        if (await isBudgetReady()) {
          answer = await recordExpenseViaApi(expense);
        } else {
          deferredDeepLinkExpense = expense; // fall back to the deep link below
        }
      }

      const editExpense = p.actions.find(
        (a) => a.tool === 'update_expense' || a.tool === 'delete_expense',
      );
      if (editExpense) {
        answer = await editExpenseViaApi(editExpense);
      }

      const free = p.actions.find((action) => action.tool === 'find_free_time');
      if (free) {
        const slots = freeSlots(readable(free), new Date(free.datetime ?? ''), new Date(free.end_datetime ?? ''), free.duration_minutes ?? 60);
        const format = (date: string) => new Intl.DateTimeFormat(languageRef.current === 'th' ? 'th-TH' : 'en-US', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date));
        answer = slots.length ? `Available: ${slots.slice(0,5).map((slot) => `${format(slot.start)} – ${format(slot.end)}`).join('; ')}` : 'There are no free slots in that range.';
      }
      if (p.actions.some((a) => a.tool === 'set_preference')) answer = 'Preferences saved.';
      if (p.actions.some((a) => a.tool === 'assign_item')) answer = 'Assignment saved.';
      if (p.actions.some((a) => a.tool === 'set_occurrence')) answer = 'Occurrence saved.';
      const sharedActions = p.actions.filter((action) => action.tool === 'share_item');
      if (sharedActions.length) answer = `Shared in ${[...new Set(sharedActions.map((action) => spaceLabel(scope(action), available)))].join(', ')}.`;
      if (created.length) answer += ` Saved in ${[...new Set(created.map((item) => spaceLabel(item.household_id, available)))].join(', ')}.`;
      answer = localizeReply(answer, languageRef.current);
      setPlan({ ...p, speak_back: answer });
      say(answer);

      if (deferredDeepLinkExpense) {
        const date = bkkDateStr(deferredDeepLinkExpense.datetime ?? new Date());
        const res = await sendExpenseToDailyBudget({
          amount: deferredDeepLinkExpense.amount as number,
          note: deferredDeepLinkExpense.title,
          date,
        });
        if (!res.ok) say('I could not open Daily Budget. Please check that it is installed.');
      }

      // Refresh what "อันแรก / อันเมื่อกี้" points at for the next turn.
      let refItems: Item[];
      if (queryAction && queryAction.query_kind !== 'search') {
        refItems = queryItems(readable(queryAction), queryAction);
      } else if (created.length) {
        refItems = created;
      } else {
        refItems = [...itemsInSpace(snapshot(), selected)].sort((a, b) => b.created_at.localeCompare(a.created_at));
      }
      contextRef.current = { referents: toReferents(refItems), lastUtterance: rawText };
    },
    [activeHouseholdId, addItem, applyUpdate, defaultAlertMode, removeItem, say, updateItem, userId],
  );

  const executeConfirmedBulkDelete = useCallback(
    async (pending: PendingBulkDelete) => {
      const ids = new Set(pending.itemIds);
      if (useStore.getState().userId !== pending.userId) throw new Error('Account changed. Please request deletion again.');
      const available = pending.userId ? await useSpaces.getState().refresh().catch(() => []) : [];
      if (useStore.getState().userId !== pending.userId) throw new Error('Account changed. Please request deletion again.');
      const targets = useStore.getState().items.filter((item) => ids.has(item.id)
        && (item.household_id ?? null) === pending.scopes[item.id]
        && (!item.household_id || available.some((space) => space.id === item.household_id)));
      const targetIds = new Set(targets.map((item) => item.id));
      if (targets.some((item) => linkedChildren(useStore.getState().items, item).some((child) => !targetIds.has(child.id)))) {
        throw new Error('Linked reminders changed. Please request deletion again.');
      }
      await Promise.all(targets.map((item) => cancelNotifications(item.notificationIds)));
      for (const item of targets) removeItem(item.id);
      const answer = targets.length
        ? `Deleted ${targets.length} ${targets.length === 1 ? 'item' : 'items'}.`
        : 'There are no matching items left to delete.';
      setPlan({
        actions: [],
        speak_back: answer,
        needs_clarification: false,
        clarify_question: null,
      });
      contextRef.current = {
        referents: toReferents(useStore.getState().items),
        lastUtterance: 'confirm delete',
      };
      say(answer);
    },
    [removeItem, say],
  );

  const handleResult = useCallback(
    (result: TranscriptResult) => {
      setError(null);

      if (!result.text) {
        if (handsFreeEnabledRef.current) {
          handsFreePausedRef.current = true;
          setHandsFreePaused(true);
        } else {
          say('I did not hear anything. Please try again.');
        }
        return;
      }

      const currentDefaults = usePreferences.getState().personalDefaults[useStore.getState().userId ?? 'local'] ?? initialDefaults;
      languageRef.current = replyLanguage(currentDefaults.responseLanguage, result.text);
      setMemorySources([]);
      const conflict = conflictRef.current;
      if (conflict) {
        conflictRef.current = null;
        if (isDeleteConfirmation(result.text) && conflict.userId === useStore.getState().userId && conflict.space === usePreferences.getState().activeHouseholdId) {
          setThinking(true); void executePlan(conflict.plan, conflict.text, true).catch((e) => setError(String(e))).finally(() => setThinking(false)); return;
        }
        if (isDeleteCancellation(result.text)) { say(languageRef.current === 'th' ? 'ยกเลิกแล้ว' : 'Cancelled.'); return; }
        contextRef.current.pending = conflict.text;
      }
      setLast(result);
      setPlan(null);
      handsFreePausedRef.current = false;
      setHandsFreePaused(false);

      const pendingBulk = pendingBulkDeleteRef.current;
      if (pendingBulk) {
        if (isDeleteConfirmation(result.text)) {
          pendingBulkDeleteRef.current = null;
          setThinking(true);
          void executeConfirmedBulkDelete(pendingBulk)
            .catch((caught: unknown) => {
              const message = caught instanceof Error ? caught.message : String(caught);
              setError(message);
              say('Sorry, I could not delete those items.');
            })
            .finally(() => setThinking(false));
          return;
        }
        if (isDeleteCancellation(result.text)) {
          pendingBulkDeleteRef.current = null;
          const answer = 'Delete cancelled.';
          setPlan({ actions: [], speak_back: answer, needs_clarification: false, clarify_question: null });
          say(answer);
          return;
        }
        const question = `Nothing was deleted. To delete ${pendingBulk.description}, say “confirm”.`;
        setPlan({ actions: [], speak_back: question, needs_clarification: true, clarify_question: question });
        say(question);
        return;
      }

      if (isHelpQuestion(result.text)) {
        const answer = capabilityAnswer(helpOptionsRef.current, languageRef.current);
        setPlan({ actions: [], speak_back: answer, needs_clarification: false, clarify_question: null });
        say(answer);
        return;
      }
      const requestUser = useStore.getState().userId;
      const requestSpace = requestUser ? usePreferences.getState().activeHouseholdId : null;
      const currentItems = itemsInSpace(useStore.getState().items, requestSpace);
      const localDelete = planLocalDelete(result.text, currentItems, contextRef.current.referents);
      if (!localDelete && !isGroqConfigured()) {
        say(`You said: ${result.text}`);
        return;
      }

      setThinking(true);
      const planning = (async () => {
        const available = requestUser ? await useSpaces.getState().refresh().catch(() => []) : [];
        if (useStore.getState().userId !== requestUser) throw new Error('Account changed. Please try again.');
        resolveSpace({}, requestSpace, available);
        if (localDelete) return localDelete;
        const inventory = toReferents(useStore.getState().items.filter((item) => !item.household_id || available.some((space) => space.id === item.household_id)), 200).map((ref) => {
          const item = useStore.getState().items.find((item) => item.id === ref.ref);
          return { ...ref, label: `${ref.label} [space_id=${item?.household_id ?? 'personal'}]` };
        });
        return planActions(result.text, new Date(), { ...contextRef.current, inventory, spaces: available.map(({ id, name, aliases }) => ({ id, name, aliases })), selectedSpaceId: requestSpace, language: languageRef.current, defaults: currentDefaults, currentUserId: requestUser, members: available.map((space) => ({ space_id: space.id, members: space.members ?? [] })), capabilities: capabilityAnswer(helpOptionsRef.current, languageRef.current), entities: entityContext(useStore.getState().items.filter((item) => !item.household_id || available.some((space) => space.id === item.household_id)), usePreferences.getState().entityAliases[requestUser ?? 'local']) });
      })();
      planning
        .then(async (parsed) => {
          if (useStore.getState().userId !== requestUser || (requestUser ? usePreferences.getState().activeHouseholdId : null) !== requestSpace) throw new Error('Account or space changed. Please try again.');
          const available = useSpaces.getState().spaces;
          const allItems = useStore.getState().items.filter((item) => !item.household_id || available.some((space) => space.id === item.household_id));
          const resolvedPlan: BrainPlan = {
            ...parsed,
            actions: parsed.actions.map((action) => {
              if (action.tool !== 'delete_item' || action.target_ref?.startsWith('external:')) return action;
              const currentItems = itemsInSpace(allItems, resolveSpace(action, requestSpace, available));
              const refExists = currentItems.some((item) => item.id === action.target_ref);
              if (refExists) return action;
              const fallback = resolveDeleteTarget(action.title, currentItems);
              return fallback ? { ...action, target_ref: fallback.id } : action;
            }),
          };
          setPlan(resolvedPlan);
          // Not confident enough — ask instead of guessing; next turn completes it.
          if (resolvedPlan.needs_clarification && resolvedPlan.clarify_question) {
            contextRef.current = { ...contextRef.current, pending: [contextRef.current.pending, result.text].filter(Boolean).join("; ") };
            say(resolvedPlan.clarify_question);
            return;
          }

          if (resolvedPlan.actions.some(a => ['delete_item', 'update_item', 'share_item', 'assign_item', 'set_occurrence'].includes(a.tool) && a.target_ref?.startsWith('external:'))) throw new Error(languageRef.current === 'th' ? 'นัดจากปฏิทินที่เชื่อมต่ออ่านได้อย่างเดียว กรุณาแก้ไขในแอปปฏิทินต้นทาง' : 'Connected calendar events are read only. Edit them in the original calendar app.');
          const bulkAction = resolvedPlan.actions.find((action) => action.tool === 'delete_items');
          const enumeratedDeletes = resolvedPlan.actions.filter(
            (action) => action.tool === 'delete_item' && !!action.target_ref,
          );
          const directCandidates = bulkAction
            ? itemsForDeleteScope(itemsInSpace(allItems, resolveSpace(bulkAction, requestSpace, available)), bulkAction.delete_scope)
            : enumeratedDeletes.length > 1
              ? useStore
                  .getState()
                  .items.filter((item) =>
                    enumeratedDeletes.some((action) => action.target_ref === item.id && (item.household_id ?? null) === resolveSpace(action, requestSpace, available)),
                  )
              : [];
          const candidates = [...new Map(directCandidates.flatMap((item) => [item, ...linkedChildren(allItems, item)]).map((item) => [item.id, item])).values()];
          if (bulkAction || enumeratedDeletes.length > 1) {
            if (!candidates.length) {
              const answer = bulkAction?.delete_scope
                ? `I could not find ${deleteScopeLabel(bulkAction.delete_scope)}.`
                : 'I could not find the items you wanted to delete.';
              setPlan({ ...resolvedPlan, speak_back: answer, needs_clarification: false, clarify_question: null });
              say(answer);
              return;
            }
            const description = bulkAction?.delete_scope
              ? deleteScopeLabel(bulkAction.delete_scope)
              : `${candidates.length} selected items`;
            const question = `I found ${candidates.length} ${candidates.length === 1 ? 'item' : 'items'}. To delete ${description}, say “confirm”.`;
            pendingBulkDeleteRef.current = {
              itemIds: candidates.map((item) => item.id),
              description,
              userId: requestUser,
              scopes: Object.fromEntries(candidates.map((item) => [item.id, item.household_id ?? null])),
            };
            setPlan({ ...resolvedPlan, speak_back: question, needs_clarification: true, clarify_question: question });
            say(question);
            return;
          }
          await executePlan(resolvedPlan, result.text);
        })
        .catch((caught: unknown) => {
          const message = caught instanceof Error ? caught.message : String(caught);
          setError(message);
          say('Sorry, I could not process that request.');
        })
        .finally(() => setThinking(false));
    },
    [executeConfirmedBulkDelete, executePlan, say],
  );

  const commitDelete = useCallback(
    (item: Item) => {
      void cancelNotifications(item.notificationIds);
      removeItem(item.id);
    },
    [removeItem],
  );

  const handleDelete = useCallback(
    (item: Item) => {
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
      if (pendingDelete && pendingDelete.id !== item.id) commitDelete(pendingDelete);
      setPendingDelete(item);
      deleteTimerRef.current = setTimeout(() => {
        commitDelete(item);
        setPendingDelete((current) => (current?.id === item.id ? null : current));
        deleteTimerRef.current = null;
      }, 6000);
    },
    [commitDelete, pendingDelete],
  );

  const handleUndoDelete = useCallback(() => {
    if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    deleteTimerRef.current = null;
    setPendingDelete(null);
  }, []);

  const handleSaveEdit = useCallback(
    async (patch: ItemEditPatch) => {
      const item = editingItem;
      if (!item) return;
      await cancelNotifications(item.notificationIds);
      const next = { ...item, ...patch };
      const notificationIds = await scheduleForItem(next);
      await updateItem(item.id, { ...patch, notificationIds });
      setEditingItem(null);
    },
    [editingItem, updateItem],
  );

  const handleAlertModeChange = useCallback(
    async (item: Item) => {
      const patch: Pick<Item, 'alert_mode' | 'remind_until_done'> =
        item.alert_mode === 'notification'
          ? { alert_mode: 'alarm', remind_until_done: false }
          : item.remind_until_done
            ? { alert_mode: 'notification', remind_until_done: false }
            : { alert_mode: 'alarm', remind_until_done: true };
      await ensureNotifyPermission();
      await cancelNotifications(item.notificationIds);
      const next = { ...item, ...patch };
      const notificationIds = await scheduleForItem(next);
      await updateItem(item.id, { ...patch, notificationIds });
    },
    [updateItem],
  );

  const handleSnoozeMinutesChange = useCallback(
    async (item: Item) => {
      const choices: SnoozeMinutes[] = [5, 10, 30];
      const current = choices.indexOf(item.snooze_minutes);
      const snooze_minutes = choices[(current + 1) % choices.length];
      await cancelNotifications(item.notificationIds);
      const next = { ...item, snooze_minutes };
      const notificationIds = await scheduleForItem(next);
      await updateItem(item.id, { snooze_minutes, notificationIds });
    },
    [updateItem],
  );

  const handleToggleDone = useCallback(
    async (item: Item, occurrence = dateKey(new Date())) => {
      if (item.recurrence) {
        if (!occursOn(item, new Date(`${occurrence}T12:00:00+07:00`))) { setError('วันนี้ไม่มีรอบของรายการนี้ เลือกวันที่ใน Calendar หรือบอกวันที่ด้วยเสียง'); return; }
        const patch = occurrencePatch(item, occurrence, item.details?.occurrences?.[occurrence] === 'done' ? 'pending' : 'done');
        await cancelNotifications(item.notificationIds);
        await updateItem(item.id, { ...patch, notificationIds: await scheduleForItem({ ...item, ...patch }) }); return;
      }
      if (!item.done) {
        await cancelNotifications(item.notificationIds);
        await updateItem(item.id, { done: true, notificationIds: [] });
        return;
      }
      await ensureNotifyPermission();
      const next = { ...item, done: false };
      const notificationIds = await scheduleForItem(next);
      await updateItem(item.id, { done: false, notificationIds });
    },
    [updateItem],
  );

  const handleError = useCallback((message: string) => {
    setError(message);
    if (handsFreeEnabledRef.current) {
      handsFreePausedRef.current = true;
      setHandsFreePaused(true);
    }
  }, []);

  const { status, partial, start, toggle, cancel, requestPermission } = useVoiceInput({
    engine,
    autoStop: autoStopEnabled,
    onResult: handleResult,
    onError: handleError,
  });

  startListeningRef.current = start;
  cancelListeningRef.current = cancel;
  voiceStatusRef.current = status;

  const listening = status === 'listening';
  const busy = status === 'transcribing';
  const activeEngine = engines.find((candidate) => candidate.id === engine);
  const talkAutoListenEligible =
    activeTab === 'talk' &&
    appIsActive &&
    !!activeEngine?.available;

  // Entering Talk always starts one voice turn. This is deliberately separate
  // from Hands-free, which only controls whether listening continues later.
  useEffect(() => {
    const onTalk = activeTab === 'talk' && appIsActive;
    if (onTalk && !wasOnTalkRef.current) {
      handsFreePausedRef.current = false;
      setHandsFreePaused(false);
      setError(null);
    }
    wasOnTalkRef.current = onTalk;
  }, [activeTab, appIsActive]);

  useEffect(() => {
    if (!talkAutoListenEligible) {
      if (!talkWasEligibleRef.current) return;
      talkWasEligibleRef.current = false;
      responseTokenRef.current += 1;
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
      if (speakingRef.current) stopSpeaking();
      speakingRef.current = false;
      setSpeaking(false);
      void cancel();
      return;
    }

    if (talkWasEligibleRef.current) return;
    talkWasEligibleRef.current = true;
    handsFreePausedRef.current = false;
    setHandsFreePaused(false);

    let disposed = false;
    void requestPermission().then((granted) => {
      if (
        disposed ||
        activeTabRef.current !== 'talk' ||
        !appIsActiveRef.current
      ) {
        return;
      }
      if (!granted) {
        handsFreePausedRef.current = true;
        setHandsFreePaused(true);
        setError('Microphone access was not granted.');
        return;
      }

      if (!hasGreetedRef.current) {
        hasGreetedRef.current = true;
        say('สวัสดีค่ะ มีอะไรให้ช่วยบอกได้เลย', config.locale, true);
      } else {
        scheduleListeningStart(200, true);
      }
    });

    return () => {
      disposed = true;
    };
  }, [cancel, requestPermission, say, scheduleListeningStart, talkAutoListenEligible]);

  const handleVoicePress = useCallback(() => {
    handsFreePausedRef.current = false;
    setHandsFreePaused(false);

    if (speakingRef.current) {
      responseTokenRef.current += 1;
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
      stopSpeaking();
      speakingRef.current = false;
      setSpeaking(false);
      resumeTimerRef.current = setTimeout(() => {
        if (activeTabRef.current === 'talk' && appIsActiveRef.current) void start();
      }, 200);
      return;
    }

    toggle();
  }, [start, toggle]);

  const coreStatus = busy
    ? 'TRANSCRIBING'
    : thinking
      ? 'PROCESSING'
      : speaking
        ? 'SPEAKING'
        : listening
          ? 'LISTENING'
          : handsFreeEnabled && handsFreePaused
            ? 'HANDS-FREE PAUSED'
            : 'READY FOR COMMAND';
  const visibleItems = itemsInSpace(items, userId ? activeHouseholdId : null).filter((item) => item.id !== pendingDelete?.id);
  const recentItems = visibleItems.slice(0, 3);
  const calendarItems = [...visibleItems, ...(calendarEvents.length ? externalItems(userId, userId ? activeHouseholdId : null) : [])];
  const dayItems = calendarItems
    .filter((item) => itemCoversDay(item, selectedDate))
    .sort((a, b) => (a.start_at ?? '').localeCompare(b.start_at ?? ''));

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <StatusBar style="light" />
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {activeTab !== 'settings' && <SpacePicker disabled={thinking || listening || busy} />}
          {activeTab === 'talk' && (
            <>
              <CapabilityGuide options={helpOptions} disabled={thinking || busy} onExample={(text) => { void cancelListeningRef.current(); say(text, config.locale); }} onSpeak={() => {
                setError(null);
                void cancelListeningRef.current();
                const answer = capabilityAnswer(helpOptionsRef.current, languageRef.current);
                setPlan({ actions: [], speak_back: answer, needs_clarification: false, clarify_question: null });
                say(answer);
              }} />
              <View style={styles.hero}>
                <View style={styles.coreStatusSlot}>
                  {(listening || busy || thinking || speaking || handsFreeEnabled) && (
                    <Text style={styles.coreStatus}>{coreStatus}</Text>
                  )}
                </View>
                <AICore
                  listening={listening}
                  busy={busy}
                  thinking={thinking}
                  speaking={speaking}
                  onPress={handleVoicePress}
                />
                <Pressable
                  accessibilityLabel={`Hands-free ${handsFreeEnabled ? 'on' : 'off'}`}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: handsFreeEnabled }}
                  disabled={!handsFreeEnabled && (busy || thinking)}
                  hitSlop={8}
                  onPress={toggleHandsFree}
                  style={({ pressed }) => [
                    styles.handsFreeBadge,
                    !handsFreeEnabled && styles.handsFreeBadgeOff,
                    handsFreePaused && styles.handsFreeBadgePaused,
                    pressed && styles.handsFreeBadgePressed,
                  ]}
                >
                  <Ionicons
                    name={handsFreeEnabled ? 'ear-outline' : 'ear'}
                    size={16}
                    color={handsFreeEnabled ? colors.primary : colors.textFaint}
                  />
                  <Text
                    style={[
                      styles.handsFreeBadgeText,
                      !handsFreeEnabled && styles.handsFreeBadgeTextOff,
                    ]}
                  >
                    HANDS-FREE
                  </Text>
                  <View style={[styles.handsFreeState, handsFreeEnabled && styles.handsFreeStateOn]}>
                    <Text
                      style={[
                        styles.handsFreeStateText,
                        handsFreeEnabled && styles.handsFreeStateTextOn,
                      ]}
                    >
                      {handsFreeEnabled ? 'ON' : 'OFF'}
                    </Text>
                  </View>
                </Pressable>
                {activeEngine && !activeEngine.available && (
                  <View style={styles.warningPanel}>
                    <Text style={styles.warningText}>{activeEngine.unavailableReason}</Text>
                  </View>
                )}
              </View>

              {memorySources.map((source) => <Pressable key={source.id} accessibilityRole="button" onPress={() => { const current = useStore.getState().items.find((item) => item.id === source.id); if (current) setEditingItem(current); }}><Text style={{ color: colors.primary, padding: 12 }}>📖 {source.title} · {dateKey(source.start_at ?? source.created_at)}</Text></Pressable>)}
              <View style={styles.conversation}>
                {!last && !partial && !thinking && !plan && (
                  <AssistantMessage text="What would you like me to remember?" />
                )}

                {last && (
                  <UserMessage
                    text={last.text || '(No transcript)'}
                    meta={`${last.engine === 'cloud' ? 'CLOUD STT' : last.engine === 'device' ? 'ON-DEVICE STT' : 'BROWSER STT'} · ${last.elapsedMs} MS`}
                    onReplay={last.text ? () => say(last.text, config.locale) : undefined}
                  />
                )}

            {listening && !!partial && (
              <UserMessage text={partial} meta="LIVE TRANSCRIPT" live />
            )}

            {thinking && (
              <View style={styles.aiMessageRow}>
                <AssistantAvatar active />
                <View style={[styles.messageBubble, styles.aiBubble]}>
                  <View style={styles.thinkingLine}>
                    <ActivityIndicator color={colors.primary} size="small" />
                    <Text style={styles.thinkingText}>Understanding your intent and context...</Text>
                  </View>
                </View>
              </View>
            )}

            {plan && (
              <View style={styles.aiMessageRow}>
                <AssistantAvatar active />
                <View style={styles.aiResponseColumn}>
                  <View style={[styles.messageBubble, styles.aiBubble]}>
                    <View style={styles.messageTopline}>
                      <Text style={styles.messageSender}>
                        {plan.needs_clarification ? 'VORA / NEEDS INPUT' : 'VORA / RESPONSE'}
                      </Text>
                      <Pressable
                        accessibilityLabel="Speak response again"
                        accessibilityRole="button"
                        hitSlop={10}
                        onPress={() =>
                          say(
                            plan.needs_clarification && plan.clarify_question
                              ? plan.clarify_question
                              : plan.speak_back,
                          )
                        }
                      >
                        <Text style={styles.replay}>SPEAK ↗</Text>
                      </Pressable>
                    </View>
                    <Text
                      style={[
                        styles.aiResponseText,
                        plan.needs_clarification && styles.clarifyText,
                      ]}
                    >
                      {plan.needs_clarification && plan.clarify_question
                        ? `❓ ${localizeReply(plan.clarify_question, languageRef.current)}`
                        : localizeReply(plan.speak_back, languageRef.current)}
                    </Text>
                  </View>

                  {plan.actions.map((action, index) => (
                    <View key={index} style={styles.actionCard}>
                      <View style={styles.actionHeader}>
                        <Text style={styles.actionLabel}>
                          ACTION {String(index + 1).padStart(2, '0')}
                        </Text>
                        <View style={styles.intentBadge}>
                          <Text style={styles.intentText}>{toolLabel(action.tool)}</Text>
                        </View>
                      </View>
                      <Text style={styles.actionTitle}>{action.title || '—'}</Text>
                      {describeAction(action).map((row) => (
                        <View key={row.label} style={styles.actionRow}>
                          <Text style={styles.actionRowLabel}>{row.label.toUpperCase()}</Text>
                          <Text style={styles.actionRowValue}>{row.value}</Text>
                        </View>
                      ))}
                    </View>
                  ))}
                </View>
              </View>
            )}

            {!thinking && last && !plan && !isGroqConfigured() && (
              <AssistantMessage text="Audio received. Voice test mode is active." />
            )}

            {error && (
              <View style={styles.errorPanel}>
                <Text style={styles.errorCode}>PROCESS INTERRUPTED</Text>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}
              </View>

              {hasHydrated && recentItems.length > 0 && (
                <View style={styles.memorySection}>
                  <View style={styles.cleanSectionHeading}>
                    <Text style={styles.cleanSectionTitle}>Recent items</Text>
                    <Pressable accessibilityRole="button" onPress={() => setActiveTab('items')}>
                      <Text style={styles.seeAll}>View all · {visibleItems.length}</Text>
                    </Pressable>
                  </View>
                  <View style={styles.itemList}>
                    {recentItems.map((item) => (
                      <ItemRow
                        key={item.id}
                        item={item}
                        onToggle={() => void handleToggleDone(item)}
                        onAlertModeChange={() => void handleAlertModeChange(item)}
                        onSnoozeMinutesChange={() => void handleSnoozeMinutesChange(item)}
                        onEdit={() => setEditingItem(item)}
                        onDelete={() => handleDelete(item)}
                      />
                    ))}
                  </View>
                </View>
              )}
            </>
          )}

          {activeTab === 'items' && (
            <View style={styles.memorySection}>
              <View style={styles.cleanSectionHeading}>
                <View>
                  <Text style={styles.screenTitle}>Your items</Text>
                  <Text style={styles.screenSubtitle}>{visibleItems.length} items · Tap to edit · Swipe to delete</Text>
                </View>
              </View>
              {hasHydrated && visibleItems.length ? (
                <View style={styles.itemList}>
                  {visibleItems.map((item) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      onToggle={() => void handleToggleDone(item)}
                      onAlertModeChange={() => void handleAlertModeChange(item)}
                      onSnoozeMinutesChange={() => void handleSnoozeMinutesChange(item)}
                      onEdit={() => setEditingItem(item)}
                      onDelete={() => handleDelete(item)}
                    />
                  ))}
                </View>
              ) : (
                <View style={styles.emptyState}>
                  <Ionicons name="file-tray-outline" size={44} color={colors.primary} />
                  <Text style={styles.emptyTitle}>Nothing here yet</Text>
                  <Text style={styles.emptyText}>Open Talk and tell VORA what you want to remember.</Text>
                  <Pressable style={styles.emptyButton} onPress={() => setActiveTab('talk')}>
                    <Text style={styles.emptyButtonText}>Start talking</Text>
                  </Pressable>
                </View>
              )}
            </View>
          )}

          {activeTab === 'calendar' && (
            <View style={styles.memorySection}>
              <View style={styles.cleanSectionHeading}>
                <View>
                  <Text style={styles.screenTitle}>Calendar</Text>
                  <Text style={styles.screenSubtitle}>Tap a day to see what's on it</Text>
                </View>
              </View>
              {(!userId || !activeHouseholdId) && <CalendarSyncNotice />}
              <CalendarMonth
                items={calendarItems}
                selectedDate={selectedDate}
                onSelectDate={(day) => { setSelectedDate(day); void refreshCalendars(defaultRange(new Date(`${day}T12:00:00+07:00`))); }}
              />
              <View style={styles.calendarDayHeading}>
                <Text style={styles.calendarDayTitle}>{formatDayHeading(selectedDate)}</Text>
                <Text style={styles.calendarDayCount}>
                  {dayItems.length} {dayItems.length === 1 ? 'item' : 'items'}
                </Text>
              </View>
              {dayItems.length ? (
                <View style={styles.itemList}>
                  {dayItems.map((item) => (item.externalCalendar ? <ExternalEventRow key={item.id} item={item} /> :
                    <ItemRow
                      key={item.id}
                      item={item}
                      occurrenceDay={selectedDate}
                      onToggle={() => void handleToggleDone(item, selectedDate)}
                      onAlertModeChange={() => void handleAlertModeChange(item)}
                      onSnoozeMinutesChange={() => void handleSnoozeMinutesChange(item)}
                      onEdit={() => setEditingItem(item)}
                      onDelete={() => handleDelete(item)}
                    />
                  ))}
                </View>
              ) : (
                <View style={styles.calendarEmpty}>
                  <Ionicons name="calendar-clear-outline" size={32} color={colors.textFaint} />
                  <Text style={styles.calendarEmptyText}>Nothing scheduled for this day</Text>
                </View>
              )}
            </View>
          )}

          {activeTab === 'settings' && (
            <View style={styles.settingsPage}>
              <Text style={styles.screenTitle}>Settings</Text>

              <Text style={styles.settingsSection}>Account</Text>
              <CloudSyncPanel autoOpen={!!pendingHouseholdInviteCode && !userId} />

              <Text style={styles.settingsSection}>Calendars</Text>
              <CalendarConnectionsPanel key={userId ?? 'local'} />

              <Text style={styles.settingsSection}>Assistant</Text>
              <PersonalDefaultsPanel />

              <Text style={styles.settingsSection}>People & places</Text>
              <KnowledgePanel />

              <Text style={styles.settingsSection}>Alerts</Text>
              <View style={styles.settingsGroup}>
                <View style={styles.settingsHeaderRow}>
                  <View style={styles.settingsIconTile}>
                    <Ionicons name="notifications" size={18} color={colors.primary} />
                  </View>
                  <View style={styles.settingsRowCopy}>
                    <Text style={styles.settingsRowLabel}>Default alert</Text>
                    <Text style={styles.settingsRowHint}>When a command doesn't say which</Text>
                  </View>
                </View>
                <View style={styles.segment}>
                  {(['notification', 'alarm'] as const).map((mode) => {
                    const selected = defaultAlertMode === mode;
                    return (
                      <Pressable
                        key={mode}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        onPress={() => setDefaultAlertMode(mode)}
                        style={[styles.segmentChip, selected && styles.segmentChipActive]}
                      >
                        <Ionicons
                          name={mode === 'notification' ? 'notifications-outline' : 'alarm-outline'}
                          size={16}
                          color={selected ? colors.primaryBright : colors.textMute}
                        />
                        <Text style={[styles.segmentChipText, selected && styles.segmentChipTextActive]}>
                          {mode === 'notification' ? 'Notification' : 'Alarm'}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <WebPushPanel />

              <Text style={styles.settingsSection}>Voice</Text>
              <View style={styles.settingsGroup}>
                <Pressable
                  accessibilityRole="switch"
                  accessibilityState={{ checked: handsFreeEnabled }}
                  disabled={listening || busy || thinking}
                  onPress={toggleHandsFree}
                  style={({ pressed }) => [
                    styles.settingsRow,
                    pressed && styles.settingsRowPressed,
                    (listening || busy || thinking) && styles.settingsRowDisabled,
                  ]}
                >
                  <View style={styles.settingsIconTile}>
                    <Ionicons
                      name="ear-outline"
                      size={18}
                      color={handsFreeEnabled ? colors.primary : colors.textMute}
                    />
                  </View>
                  <View style={styles.settingsRowCopy}>
                    <Text
                      style={[
                        styles.settingsRowLabel,
                        handsFreeEnabled && styles.settingsRowLabelActive,
                      ]}
                    >
                      Hands-free conversation
                    </Text>
                    <Text style={styles.settingsRowHint} numberOfLines={2}>
                      Continue listening after each AI response
                    </Text>
                  </View>
                  <View style={[styles.switchTrack, handsFreeEnabled && styles.switchTrackActive]}>
                    <View style={[styles.switchThumb, handsFreeEnabled && styles.switchThumbActive]} />
                  </View>
                </Pressable>
                <View style={styles.settingsSep} />
                <Pressable
                  accessibilityRole="switch"
                  accessibilityState={{ checked: autoStopEnabled }}
                  disabled={listening || busy || thinking}
                  onPress={() => setAutoStopEnabled(!autoStopEnabled)}
                  style={({ pressed }) => [
                    styles.settingsRow,
                    pressed && styles.settingsRowPressed,
                    (listening || busy || thinking) && styles.settingsRowDisabled,
                  ]}
                >
                  <View style={styles.settingsIconTile}>
                    <Ionicons
                      name="timer-outline"
                      size={18}
                      color={autoStopEnabled ? colors.primary : colors.textMute}
                    />
                  </View>
                  <View style={styles.settingsRowCopy}>
                    <Text style={[styles.settingsRowLabel, autoStopEnabled && styles.settingsRowLabelActive]}>
                      Stop after silence
                    </Text>
                    <Text style={styles.settingsRowHint} numberOfLines={2}>
                      {autoStopEnabled
                        ? 'Stops automatically after about 1 second of silence'
                        : 'Keep listening until you tap Stop'}
                    </Text>
                  </View>
                  <View style={[styles.switchTrack, autoStopEnabled && styles.switchTrackActive]}>
                    <View style={[styles.switchThumb, autoStopEnabled && styles.switchThumbActive]} />
                  </View>
                </Pressable>
                <View style={styles.settingsSep} />
                {engines.map((candidate, index) => {
                  const selected = candidate.id === engine;
                  const disabled = !candidate.available || listening || busy;
                  return (
                    <View key={candidate.id}>
                      {index > 0 && <View style={styles.settingsSep} />}
                      <Pressable
                        accessibilityRole="radio"
                        accessibilityState={{ selected, disabled }}
                        disabled={disabled}
                        onPress={() => {
                          setEngine(candidate.id);
                          setPreferredEngine(candidate.id);
                        }}
                        style={({ pressed }) => [
                          styles.settingsRow,
                          pressed && styles.settingsRowPressed,
                          !candidate.available && styles.settingsRowDisabled,
                        ]}
                      >
                        <View style={styles.settingsIconTile}>
                          <Ionicons name="mic" size={18} color={selected ? colors.primary : colors.textMute} />
                        </View>
                        <View style={styles.settingsRowCopy}>
                          <Text style={[styles.settingsRowLabel, selected && styles.settingsRowLabelActive]}>
                            {candidate.label}
                          </Text>
                          <Text style={styles.settingsRowHint} numberOfLines={2}>
                            {candidate.available ? candidate.hint : candidate.unavailableReason}
                          </Text>
                        </View>
                        {selected && <Ionicons name="checkmark-circle" size={22} color={colors.primary} />}
                      </Pressable>
                    </View>
                  );
                })}
              </View>

              {isBudgetApiConfigured() && (
                <>
                  <Text style={styles.settingsSection}>Daily Budget</Text>
                  <View style={styles.settingsGroup}>
                    <View style={styles.settingsHeaderRow}>
                      <View style={styles.settingsIconTile}>
                        <Ionicons
                          name={budgetConnected ? 'wallet' : 'wallet-outline'}
                          size={18}
                          color={budgetConnected ? colors.primary : colors.textMute}
                        />
                      </View>
                      <View style={styles.settingsRowCopy}>
                        <Text style={styles.settingsRowLabel}>
                          {budgetConnected ? 'Connected' : 'Not connected'}
                        </Text>
                        <Text style={styles.settingsRowHint}>
                          {budgetConnected
                            ? 'Ask about your budget and log expenses by voice'
                            : 'Link your Daily Budget account to enable budget voice commands'}
                        </Text>
                      </View>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      disabled={budgetBusy}
                      onPress={budgetConnected ? handleDisconnectBudget : handleConnectBudget}
                      style={({ pressed }) => [
                        styles.budgetBtn,
                        budgetConnected && styles.budgetBtnDisconnect,
                        pressed && styles.settingsRowPressed,
                        budgetBusy && styles.settingsRowDisabled,
                      ]}
                    >
                      {budgetBusy ? (
                        <ActivityIndicator size="small" color={colors.primaryBright} />
                      ) : (
                        <>
                          <Ionicons
                            name={budgetConnected ? 'unlink-outline' : 'link-outline'}
                            size={18}
                            color={budgetConnected ? colors.danger : colors.primaryBright}
                          />
                          <Text
                            style={[
                              styles.budgetBtnText,
                              budgetConnected && styles.budgetBtnTextDisconnect,
                            ]}
                          >
                            {budgetConnected ? 'Disconnect' : 'Connect Daily Budget'}
                          </Text>
                        </>
                      )}
                    </Pressable>
                  </View>
                </>
              )}

              <Text style={styles.settingsSection}>Sharing</Text>
              <HouseholdPanel
                pendingInviteCode={pendingHouseholdInviteCode}
                onClearPendingInvite={dismissHouseholdInvite}
              />
            </View>
          )}
        </ScrollView>

        {pendingDelete && (
          <View style={styles.undoBar}>
            <Text style={styles.undoText} numberOfLines={1}>Deleted “{pendingDelete.title}”</Text>
            <Pressable accessibilityRole="button" hitSlop={8} onPress={handleUndoDelete}>
              <Text style={styles.undoAction}>UNDO</Text>
            </Pressable>
          </View>
        )}

        <SafeAreaView edges={['bottom']} style={styles.bottomSafeArea}>
          <BottomNav active={activeTab} onChange={setActiveTab} itemCount={visibleItems.length} />
        </SafeAreaView>
        <EditItemModal
          extra={editingItem && <ItemActionsPanel item={items.find((i) => i.id === editingItem.id) ?? editingItem} members={useSpaces.getState().spaces.find((space) => space.id === editingItem.household_id)?.members ?? []}
            onAssignment={(assignee,recipients) => { void (async () => {
              const item = useStore.getState().items.find((i) => i.id === editingItem.id)!;
              const spaces = await useSpaces.getState().refresh();
              const patch = assignmentPatch(item, assignee, recipients, spaces.find((s) => s.id === item.household_id)?.members ?? []);
              await cancelNotifications(item.notificationIds); await updateItem(item.id, { ...patch, notificationIds: await scheduleForItem({ ...item,...patch }) });
            })().catch((e) => setError(String(e))); }}
            onOccurrence={(status) => { void (async () => { const item = useStore.getState().items.find((i) => i.id === editingItem.id)!; const patch = occurrencePatch(item, dateKey(new Date()), status); await cancelNotifications(item.notificationIds); await updateItem(item.id, { ...patch, notificationIds: await scheduleForItem({ ...item, ...patch }) }); })().catch((e) => setError(String(e))); }} />}
          item={editingItem}
          onClose={() => setEditingItem(null)}
          onSave={(patch) => void handleSaveEdit(patch)}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function BottomNav({
  active,
  onChange,
  itemCount,
}: {
  active: AppTab;
  onChange: (tab: AppTab) => void;
  itemCount: number;
}) {
  const tabs: Array<{ id: AppTab; label: string }> = [
    { id: 'talk', label: 'TALK' },
    { id: 'items', label: 'ITEMS' },
    { id: 'calendar', label: 'CALENDAR' },
    { id: 'settings', label: 'SETTINGS' },
  ];
  return (
    <View style={styles.bottomNav}>
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <Pressable
            key={tab.id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            android_ripple={{ color: colors.primarySoft, borderless: true }}
            onPress={() => onChange(tab.id)}
            style={({ pressed }) => [styles.navItem, pressed && styles.pressed]}
          >
            <View style={styles.navIconWrap}>
              <NavIcon id={tab.id} active={selected} />
              {tab.id === 'items' && itemCount > 0 && (
                <View style={styles.navCount}><Text style={styles.navCountText}>{Math.min(itemCount, 99)}</Text></View>
              )}
            </View>
            <Text style={[styles.navLabel, selected && styles.navLabelActive]}>{tab.label}</Text>
            {selected && <View style={styles.navIndicator} />}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Bottom-nav icons from Ionicons — outline when inactive, filled when active. */
function NavIcon({ id, active }: { id: AppTab; active: boolean }) {
  const name: IoniconName =
    id === 'talk'
      ? active
        ? 'mic'
        : 'mic-outline'
      : id === 'items'
        ? active
          ? 'list'
          : 'list-outline'
        : id === 'calendar'
          ? active
            ? 'calendar'
            : 'calendar-outline'
          : active
            ? 'settings'
            : 'settings-outline';
  return <Ionicons name={name} size={23} color={active ? colors.primary : colors.textFaint} />;
}

function HudBackdrop() {
  return (
    <View pointerEvents="none" style={styles.backdrop}>
      {HUD_HORIZONTAL_LINES.map((top) => (
        <View key={`h-${top}`} style={[styles.gridHorizontal, { top }]} />
      ))}
      {HUD_VERTICAL_LINES.map((left) => (
        <View key={`v-${left}`} style={[styles.gridVertical, { left }]} />
      ))}
      {HUD_PARTICLES.map((position, index) => (
        <View key={`p-${index}`} style={[styles.particle, position]} />
      ))}
      <View style={styles.backdropGlow} />
    </View>
  );
}

function TelemetryCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.telemetryCell}>
      <Text style={styles.telemetryLabel}>{label}</Text>
      <Text style={styles.telemetryValue}>{value}</Text>
    </View>
  );
}

function SectionHeader({ index, title }: { index: string; title: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionIndex}>{index}</Text>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionLine} />
      <View style={styles.sectionDiamond} />
    </View>
  );
}

function AssistantAvatar({ active = false }: { active?: boolean }) {
  return (
    <View style={[styles.avatar, active && styles.avatarActive]}>
      <View style={styles.avatarInner}>
        <Text style={styles.avatarLetter}>V</Text>
      </View>
    </View>
  );
}

function AssistantMessage({ text }: { text: string }) {
  return (
    <View style={styles.aiMessageRow}>
      <AssistantAvatar />
      <View style={[styles.messageBubble, styles.aiBubble]}>
        <Text style={styles.messageSender}>VORA / READY</Text>
        <Text style={styles.aiResponseText}>{text}</Text>
      </View>
    </View>
  );
}

function UserMessage({
  text,
  meta,
  live = false,
  onReplay,
}: {
  text: string;
  meta: string;
  live?: boolean;
  onReplay?: () => void;
}) {
  return (
    <View style={styles.userMessageRow}>
      <View style={[styles.messageBubble, styles.userBubble, live && styles.liveBubble]}>
        <View style={styles.messageTopline}>
          <Text style={styles.userSender}>YOU / {meta}</Text>
          {onReplay && (
            <Pressable
              accessibilityLabel="Replay transcript"
              accessibilityRole="button"
              hitSlop={10}
              onPress={onReplay}
            >
              <Text style={styles.replay}>REPLAY ↗</Text>
            </Pressable>
          )}
        </View>
        <Text style={[styles.userMessageText, live && styles.liveText]}>{text}</Text>
      </View>
      <View style={styles.userNode}>
        <View style={styles.userNodeInner} />
      </View>
    </View>
  );
}

function AICore({
  listening,
  busy,
  thinking,
  speaking,
  onPress,
}: {
  listening: boolean;
  busy: boolean;
  thinking: boolean;
  speaking: boolean;
  onPress: () => void;
}) {
  const rotation = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(1)).current;
  const active = listening || busy || thinking || speaking;

  useEffect(() => {
    rotation.setValue(0);
    const loop = Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: active ? 5200 : 14000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [active, rotation]);

  useEffect(() => {
    if (!active) {
      pulse.stopAnimation();
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.055,
          duration: 720,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 720,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, pulse]);

  const clockwise = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });
  const counterClockwise = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['360deg', '0deg'],
  });

  return (
    <View style={styles.coreStage}>
      <View style={styles.coreVisual}>
        <View style={styles.crosshairHorizontal} />
        <View style={styles.crosshairVertical} />

        {CORE_TICKS.map((index) => (
          <View
            key={index}
            style={[styles.tickOrbit, { transform: [{ rotate: `${index * 15}deg` }] }]}
          >
            <View style={[styles.coreTick, index % 3 === 0 && styles.coreTickMajor]} />
          </View>
        ))}

        <Animated.View
          style={[
            styles.outerArc,
            active && styles.outerArcActive,
            { transform: [{ rotate: clockwise }] },
          ]}
        />
        <Animated.View
          style={[styles.midArc, { transform: [{ rotate: counterClockwise }] }]}
        />
        <View style={[styles.innerHalo, active && styles.innerHaloActive]} />

        <Animated.View style={[styles.corePulse, { transform: [{ scale: pulse }] }]}>
          <Pressable
            accessibilityLabel={
              listening ? 'Stop listening' : speaking ? 'Interrupt and start talking' : 'Start talking'
            }
            accessibilityRole="button"
            disabled={busy || thinking}
            onPress={onPress}
            style={({ pressed }) => [
              styles.coreButton,
              active && styles.coreButtonActive,
              listening && styles.coreButtonListening,
              pressed && styles.coreButtonPressed,
            ]}
          >
            {busy ? (
              <ActivityIndicator color={colors.primaryBright} size="large" />
            ) : (
              <>
                {listening ? (
                  <Ionicons name="stop" size={30} color={colors.danger} />
                ) : (
                  <Ionicons
                    name="mic-outline"
                    size={42}
                    color={active ? colors.primaryBright : colors.primary}
                  />
                )}
                <Text style={styles.coreButtonLabel}>
                  {thinking
                    ? 'THINKING'
                    : speaking
                      ? 'TAP TO INTERRUPT'
                      : listening
                        ? 'TAP TO STOP'
                        : 'TAP TO TALK'}
                </Text>
                <View style={styles.waveform}>
                  {WAVEFORM_HEIGHTS.map((height, index) => (
                    <View
                      key={index}
                      style={[
                        styles.waveBar,
                        { height: active ? height : Math.max(2, Math.floor(height / 3)) },
                      ]}
                    />
                  ))}
                </View>
              </>
            )}
          </Pressable>
        </Animated.View>

        <Text style={[styles.orbitCode, styles.orbitCodeLeft]}>VR-01</Text>
        <Text style={[styles.orbitCode, styles.orbitCodeRight]}>TH-AI</Text>
      </View>
    </View>
  );
}


type IoniconName = keyof typeof Ionicons.glyphMap;
const TYPE_META: Record<Item['type'], { icon: IoniconName; label: string }> = {
  reminder: { icon: 'alarm-outline', label: 'REMINDER' },
  event: { icon: 'calendar-outline', label: 'EVENT' },
  todo: { icon: 'checkbox-outline', label: 'TODO' },
  note: { icon: 'document-text-outline', label: 'NOTE' },
};

/** True when a dated item falls on `day` ('YYYY-MM-DD', Bangkok) — matching its
 *  start day, or any day inside its start–end range. Undated notes never match. */
function itemCoversDay(item: Item, day: string): boolean {
  return occursOn(item, new Date(`${day}T12:00:00+07:00`));
}

/** "Today", "Tomorrow", or "Wed, 10 Sep 2026" for the day-list heading. */
function formatDayHeading(day: string): string {
  const today = bkkDateStr();
  if (day === today) return 'Today';
  const tomorrow = new Date(`${today}T00:00:00+07:00`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (day === bkkDateStr(tomorrow)) return 'Tomorrow';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${day}T00:00:00+07:00`));
}

/** Build the referable-items list the brain uses to resolve "อันแรก" etc.
 *  Includes the raw ISO start so the model can edit time while keeping the day. */
function toReferents(items: Item[], limit = 8): Referent[] {
  return items.slice(0, limit).map((item) => {
    const when = formatDateTime(item.start_at, item.all_day);
    const iso = item.start_at ? ` {${item.start_at}}` : '';
    const mode =
      item.type === 'reminder'
        ? ` [${
            item.remind_until_done
              ? 'UNTIL DONE'
              : item.alert_mode === 'alarm'
                ? 'ALARM'
                : 'NOTIFICATION'
          }]`
        : '';
    const state = item.done ? ' [DONE]' : '';
    return { ref: item.id, label: `${item.title}${when ? ` — ${when}` : ''}${mode}${state}${iso}` };
  });
}

function ItemRow({
  item,
  occurrenceDay = dateKey(new Date()),
  onToggle,
  onAlertModeChange,
  onSnoozeMinutesChange,
  onEdit,
  onDelete,
}: {
  item: Item;
  occurrenceDay?: string;
  onToggle: () => void;
  onAlertModeChange: () => void;
  onSnoozeMinutesChange: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const when = formatDateTime(item.start_at, item.all_day);
  const end = formatDateTime(item.end_at, item.all_day);
  const recurrence = formatRecurrence(item.recurrence);
  const detail = [when && (end ? `${when} – ${end}` : when), recurrence]
    .filter(Boolean)
    .join(' · ');
  const meta = TYPE_META[item.type];
  const occurrenceStatus = item.recurrence ? item.details?.occurrences?.[occurrenceDay] : undefined;
  const checked = item.done || occurrenceStatus === 'done';

  return (
    <SwipeableRow onDelete={onDelete}>
      <Pressable
        accessibilityLabel={`Edit ${item.title}`}
        accessibilityHint="Opens the editor. Swipe left to delete."
        android_ripple={{ color: colors.primarySoft }}
        onPress={onEdit}
        style={({ pressed }) => [
          styles.itemRow,
          checked && styles.itemRowDone,
          pressed && styles.itemRowPressed,
        ]}
      >
        <Pressable
          accessibilityLabel={checked ? `Mark ${item.title} as not done` : `Mark ${item.title} as done`}
          accessibilityRole="checkbox"
          accessibilityState={{ checked }}
          hitSlop={10}
          onPress={onToggle}
          style={[styles.itemIcon, checked && styles.itemIconDone]}
        >
          <Ionicons
            name={checked ? 'checkmark' : meta.icon}
            size={18}
            color={checked ? colors.success : colors.primaryBright}
          />
        </Pressable>
        <View style={styles.itemBody}>
          <View style={styles.itemTypeRow}>
            <Text style={styles.itemType}>{meta.label}</Text>
            <ItemSpaceBadge spaceId={item.household_id} />
            {occurrenceStatus && <Text style={styles.sharedBadge}>{occurrenceDay} · {occurrenceStatus === 'done' ? 'ทำแล้ว' : 'ข้าม'}</Text>}
            {item.details?.shopping && <Text style={styles.sharedBadge}>{item.details.shopping.list} · {item.details.shopping.quantity} {item.details.shopping.unit}</Text>}
          </View>
          <Text style={[styles.itemTitle, checked && styles.itemTitleDone]} numberOfLines={1}>
            {item.title}
          </Text>
          {!!detail && <Text style={styles.itemSub}>{detail}</Text>}
          {item.type === 'reminder' && (
            <View style={styles.alertControls}>
              <Pressable
                accessibilityLabel={`Change alert type for ${item.title}`}
                accessibilityHint="Cycles through notification, alarm, and until done"
                accessibilityRole="button"
                hitSlop={8}
                onPress={onAlertModeChange}
                style={[
                  styles.alertModeButton,
                  item.alert_mode === 'alarm' && styles.alertModeButtonAlarm,
                ]}
              >
                <Ionicons
                  name={
                    item.remind_until_done
                      ? 'repeat'
                      : item.alert_mode === 'alarm'
                        ? 'alarm'
                        : 'notifications-outline'
                  }
                  size={12}
                  color={item.alert_mode === 'alarm' ? colors.warning : colors.textFaint}
                />
                <Text
                  style={[
                    styles.alertModeText,
                    item.alert_mode === 'alarm' && styles.alertModeTextAlarm,
                  ]}
                >
                  {item.remind_until_done
                    ? 'UNTIL DONE'
                    : item.alert_mode === 'alarm'
                      ? 'ALARM'
                      : 'NOTIFY'}
                </Text>
              </Pressable>
              {item.alert_mode === 'alarm' && (
                <Pressable
                  accessibilityLabel={`Change snooze time for ${item.title}`}
                  accessibilityRole="button"
                  hitSlop={6}
                  onPress={onSnoozeMinutesChange}
                  style={styles.snoozeButton}
                >
                  <Text style={styles.snoozeText}>
                    SNOOZE {item.snooze_minutes}M · ×{item.max_attempts}
                  </Text>
                </Pressable>
              )}
            </View>
          )}
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} style={styles.itemChevron} />
      </Pressable>
    </SwipeableRow>
  );
}

const SWIPE_ACTION_WIDTH = 112;
const SWIPE_DELETE_THRESHOLD = 88;

/** Native-feeling row: the gesture and horizontal motion stay on the UI thread,
 *  while the data deletion still routes through the existing undo flow. */
function SwipeableRow({ onDelete, children }: { onDelete: () => void; children: ReactNode }) {
  const translateX = useSharedValue(0);
  const dragStartX = useSharedValue(0);
  const rowWidth = useSharedValue(0);
  const deleting = useSharedValue(false);
  const onDeleteRef = useRef(onDelete);
  onDeleteRef.current = onDelete;

  const finishDelete = useCallback(() => onDeleteRef.current(), []);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        // Claim deliberate left swipes only. A vertical move fails early so the
        // surrounding ScrollView keeps control while the user browses the list.
        .activeOffsetX([-12, 100_000])
        .failOffsetY([-12, 12])
        .cancelsTouchesInView(true)
        .onStart(() => {
          cancelAnimation(translateX);
          dragStartX.value = translateX.value;
        })
        .onUpdate((event) => {
          const rawX = Math.min(0, dragStartX.value + event.translationX);
          translateX.value =
            rawX < -SWIPE_ACTION_WIDTH
              ? -SWIPE_ACTION_WIDTH + (rawX + SWIPE_ACTION_WIDTH) * 0.2
              : rawX;
        })
        .onEnd((event) => {
          const shouldDelete =
            event.translationX < -SWIPE_DELETE_THRESHOLD ||
            (event.translationX < -24 && event.velocityX < -800);

          if (shouldDelete) {
            deleting.value = true;
            translateX.value = withTiming(
              -rowWidth.value - 32,
              {
                duration: 180,
                easing: ReanimatedEasing.out(ReanimatedEasing.cubic),
              },
              (finished) => {
                if (finished) scheduleOnRN(finishDelete);
              },
            );
          } else {
            translateX.value = withSpring(0, {
              damping: 22,
              stiffness: 260,
              mass: 0.75,
              overshootClamping: true,
            });
          }
        })
        .onFinalize((_event, success) => {
          if (!success && !deleting.value) {
            translateX.value = withSpring(0, {
              damping: 22,
              stiffness: 260,
              mass: 0.75,
              overshootClamping: true,
            });
          }
        }),
    [deleting, dragStartX, finishDelete, rowWidth, translateX],
  );

  const rowAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const backdropAnimatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      translateX.value,
      [-SWIPE_DELETE_THRESHOLD, -28, 0],
      [1, 0.45, 0],
      Extrapolation.CLAMP,
    ),
  }));

  return (
    <Reanimated.View
      layout={LinearTransition.duration(180).easing(ReanimatedEasing.out(ReanimatedEasing.cubic))}
      onLayout={({ nativeEvent }) => {
        rowWidth.value = nativeEvent.layout.width;
      }}
      style={styles.swipeContainer}
    >
      <Reanimated.View
        pointerEvents="none"
        style={[styles.swipeBackdrop, backdropAnimatedStyle]}
      >
        <View style={styles.swipeDeleteBadge}>
          <Ionicons name="trash-outline" size={22} color="#fff" />
          <Text style={styles.swipeDeleteLabel}>DELETE</Text>
        </View>
      </Reanimated.View>
      <GestureDetector gesture={pan} touchAction="pan-y">
        <Reanimated.View style={rowAnimatedStyle}>{children}</Reanimated.View>
      </GestureDetector>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  gestureRoot: { flex: 1 },
  safe: { flex: 1, backgroundColor: colors.bg },
  bottomSafeArea: { backgroundColor: colors.bgAlt },
  backdrop: { position: 'absolute', inset: 0, overflow: 'hidden' },
  gridHorizontal: {
    position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(68, 241, 255, 0.045)',
  },
  gridVertical: {
    position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(68, 241, 255, 0.04)',
  },
  particle: {
    position: 'absolute', width: 3, height: 3, borderRadius: radius.pill,
    backgroundColor: colors.primary, opacity: 0.35,
  },
  backdropGlow: {
    position: 'absolute', width: 420, height: 420, borderRadius: 210, top: 80,
    alignSelf: 'center', backgroundColor: 'rgba(0, 113, 145, 0.07)',
  },
  container: {
    flexGrow: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.md,
    paddingBottom: spacing.xl, gap: spacing.xl,
  },
  telemetry: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  telemetryCell: { flex: 1, alignItems: 'center', gap: 3 },
  telemetryDivider: { width: StyleSheet.hairlineWidth, height: 25, backgroundColor: colors.border },
  telemetryLabel: { color: colors.textFaint, fontSize: 7, letterSpacing: 1.5 },
  telemetryValue: { color: colors.textMute, fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  hero: { alignItems: 'center' },
  heroTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  microLine: { width: 22, height: 1, backgroundColor: colors.borderBright },
  heroEyebrow: { color: colors.textFaint, fontSize: 8, fontWeight: '700', letterSpacing: 2 },
  coreStatusSlot: { minHeight: 30, justifyContent: 'center', marginTop: spacing.sm },
  coreStatus: {
    color: colors.primaryBright, fontSize: font.lg, fontWeight: '400', letterSpacing: 3,
  },
  coreStage: { width: 286, height: 286, marginTop: spacing.sm },
  coreVisual: { width: 286, height: 286, alignItems: 'center', justifyContent: 'center' },
  crosshairHorizontal: {
    position: 'absolute', left: 0, right: 0, top: 143, height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(68, 241, 255, 0.16)',
  },
  crosshairVertical: {
    position: 'absolute', top: 0, bottom: 0, left: 143, width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(68, 241, 255, 0.12)',
  },
  tickOrbit: { position: 'absolute', width: 276, height: 276, alignItems: 'center' },
  coreTick: { width: 1, height: 7, backgroundColor: colors.borderBright, opacity: 0.55 },
  coreTickMajor: { width: 2, height: 13, backgroundColor: colors.primary, opacity: 0.9 },
  outerArc: {
    position: 'absolute', width: 246, height: 246, borderRadius: 123, borderWidth: 3,
    borderColor: colors.border, borderTopColor: colors.primary, borderRightColor: colors.blue,
    borderBottomColor: 'rgba(68, 241, 255, 0.18)', shadowColor: colors.primary,
    shadowOpacity: 0.18, shadowRadius: 12,
  },
  outerArcActive: { borderTopColor: colors.primaryBright, shadowOpacity: 0.58, shadowRadius: 20 },
  midArc: {
    position: 'absolute', width: 204, height: 204, borderRadius: 102, borderWidth: 1,
    borderColor: colors.borderBright, borderTopWidth: 5, borderBottomWidth: 3,
    borderLeftColor: 'transparent',
  },
  innerHalo: {
    position: 'absolute', width: 164, height: 164, borderRadius: 82,
    backgroundColor: 'rgba(5, 38, 50, 0.78)', borderWidth: 1, borderColor: colors.borderBright,
  },
  innerHaloActive: {
    backgroundColor: 'rgba(9, 69, 82, 0.72)', borderColor: colors.primary,
    shadowColor: colors.primary, shadowOpacity: 0.65, shadowRadius: 24,
  },
  corePulse: { width: 138, height: 138, borderRadius: 69 },
  coreButton: {
    flex: 1, borderRadius: 69, alignItems: 'center', justifyContent: 'center', gap: 7,
    backgroundColor: '#061820', borderWidth: 1, borderColor: colors.primaryDark,
    shadowColor: colors.primary, shadowOpacity: 0.22, shadowRadius: 16,
  },
  coreButtonActive: {
    backgroundColor: '#082A34', borderColor: colors.primaryBright,
    shadowOpacity: 0.75, shadowRadius: 25,
  },
  coreButtonListening: { backgroundColor: '#07303B' },
  coreButtonPressed: { opacity: 0.75 },
  coreButtonLabel: {
    color: colors.primaryBright, fontSize: 8, fontWeight: '800', letterSpacing: 1.4,
  },
  waveform: { height: 14, flexDirection: 'row', alignItems: 'center', gap: 3 },
  waveBar: { width: 2, backgroundColor: colors.primary, borderRadius: 1 },
  orbitCode: { position: 'absolute', color: colors.textFaint, fontSize: 7, letterSpacing: 1 },
  orbitCodeLeft: { left: 5, top: 132, transform: [{ rotate: '-90deg' }] },
  orbitCodeRight: { right: 1, top: 147, transform: [{ rotate: '90deg' }] },
  coreHint: { color: colors.textFaint, fontSize: font.sm, textAlign: 'center', marginTop: spacing.xs },
  coreHintActive: { color: colors.textMute },
  handsFreeBadge: {
    minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: spacing.xs,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.primaryDark, backgroundColor: colors.primarySoft,
  },
  handsFreeBadgeOff: { borderColor: colors.border, backgroundColor: colors.card },
  handsFreeBadgePaused: {
    borderColor: colors.warning, backgroundColor: 'rgba(255, 209, 102, 0.07)',
  },
  handsFreeBadgePressed: { opacity: 0.7 },
  handsFreeBadgeText: {
    color: colors.primaryBright, fontSize: 8, fontWeight: '800', letterSpacing: 0.8,
  },
  handsFreeBadgeTextOff: { color: colors.textMute },
  handsFreeState: {
    minWidth: 30, alignItems: 'center', paddingHorizontal: 6, paddingVertical: 3,
    borderRadius: radius.pill, backgroundColor: colors.cardRaised,
  },
  handsFreeStateOn: { backgroundColor: colors.primaryDark },
  handsFreeStateText: { color: colors.textFaint, fontSize: 7, fontWeight: '900' },
  handsFreeStateTextOn: { color: colors.primaryBright },
  warningPanel: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: 'rgba(255, 209, 102, 0.07)', borderLeftWidth: 2,
    borderLeftColor: colors.warning,
  },
  warningCode: { color: colors.warning, fontSize: 8, fontWeight: '800', letterSpacing: 1 },
  warningText: { color: colors.textMute, fontSize: font.xs, flexShrink: 1 },
  enginePanel: {
    position: 'relative', backgroundColor: 'rgba(5, 19, 27, 0.88)',
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm,
  },
  panelCornerTopLeft: {
    position: 'absolute', top: -1, left: -1, width: 18, height: 18,
    borderTopWidth: 2, borderLeftWidth: 2, borderColor: colors.primary,
  },
  panelCornerBottomRight: {
    position: 'absolute', bottom: -1, right: -1, width: 18, height: 18,
    borderBottomWidth: 2, borderRightWidth: 2, borderColor: colors.primary,
  },
  panelLabel: { color: colors.textFaint, fontSize: 8, fontWeight: '700', letterSpacing: 1.5 },
  pressed: { opacity: 0.7 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm,
  },
  sectionIndex: { color: colors.primary, fontSize: 8, fontWeight: '800', letterSpacing: 1 },
  sectionTitle: { color: colors.textMute, fontSize: 9, fontWeight: '800', letterSpacing: 1.6 },
  sectionLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  sectionDiamond: {
    width: 5, height: 5, borderWidth: 1, borderColor: colors.primary,
    transform: [{ rotate: '45deg' }],
  },
  conversation: { gap: spacing.lg },
  aiMessageRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  userMessageRow: {
    flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'flex-start', gap: spacing.md,
  },
  avatar: {
    width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: colors.borderBright,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgAlt,
  },
  avatarActive: {
    borderColor: colors.primary, shadowColor: colors.primary, shadowOpacity: 0.5, shadowRadius: 8,
  },
  avatarInner: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: colors.primaryDark,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarLetter: { color: colors.primaryBright, fontSize: 9, fontWeight: '800' },
  aiResponseColumn: { flex: 1, gap: spacing.sm },
  messageBubble: { padding: spacing.md, gap: spacing.sm, borderWidth: 1 },
  aiBubble: {
    flex: 1, backgroundColor: 'rgba(7, 28, 38, 0.92)', borderColor: colors.border,
    borderTopLeftRadius: 2, borderTopRightRadius: radius.lg,
    borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg,
  },
  userBubble: {
    maxWidth: '84%', backgroundColor: 'rgba(25, 65, 82, 0.56)', borderColor: colors.borderBright,
    borderTopLeftRadius: radius.lg, borderTopRightRadius: 2,
    borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg,
  },
  liveBubble: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  messageTopline: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md,
  },
  messageSender: { color: colors.primary, fontSize: 8, fontWeight: '800', letterSpacing: 1.3 },
  userSender: { color: colors.textFaint, fontSize: 8, fontWeight: '800', letterSpacing: 1 },
  replay: { color: colors.primary, fontSize: 8, fontWeight: '800', letterSpacing: 0.8 },
  aiResponseText: { color: colors.text, fontSize: font.md, lineHeight: 24 },
  clarifyText: { color: colors.warning, fontWeight: '700' },
  userMessageText: { color: colors.text, fontSize: font.md, lineHeight: 24 },
  liveText: { color: colors.primaryBright, fontStyle: 'italic' },
  userNode: {
    width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: colors.textFaint,
    alignItems: 'center', justifyContent: 'center', marginTop: 3,
  },
  userNodeInner: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.textMute },
  thinkingLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  thinkingText: { color: colors.textMute, fontSize: font.sm },
  actionCard: {
    backgroundColor: 'rgba(2, 12, 18, 0.72)', borderLeftWidth: 2,
    borderLeftColor: colors.primary, borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    padding: spacing.md, gap: spacing.sm,
  },
  actionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm,
  },
  actionLabel: { color: colors.textFaint, fontSize: 8, fontWeight: '800', letterSpacing: 1.2 },
  intentBadge: {
    backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.borderBright,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
  },
  intentText: { color: colors.primary, fontSize: 9, fontWeight: '800' },
  actionTitle: { color: colors.text, fontSize: font.lg, fontWeight: '700' },
  actionRow: { flexDirection: 'row', gap: spacing.md, paddingTop: spacing.xs },
  actionRowLabel: { color: colors.textFaint, fontSize: 9, letterSpacing: 0.6, width: 72 },
  actionRowValue: { color: colors.textMute, fontSize: font.xs, flex: 1, fontWeight: '600' },
  errorPanel: {
    backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: colors.danger,
    padding: spacing.md, gap: spacing.xs,
  },
  errorCode: { color: colors.danger, fontSize: 8, fontWeight: '800', letterSpacing: 1.2 },
  errorText: { color: colors.textMute, fontSize: font.xs },
  memorySection: { gap: spacing.md },
  itemList: { gap: spacing.sm },
  calendarDayHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  calendarDayTitle: { color: colors.text, fontSize: font.md, fontWeight: '700' },
  calendarDayCount: { color: colors.textMute, fontSize: font.sm },
  calendarEmpty: { alignItems: 'center', gap: spacing.sm, paddingVertical: 44 },
  calendarEmptyText: { color: colors.textFaint, fontSize: font.sm },
  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.card, borderWidth: 1, borderRadius: radius.lg,
    borderColor: colors.border, padding: spacing.md,
  },
  itemRowDone: { opacity: 0.48 },
  itemRowPressed: { backgroundColor: colors.cardRaised, borderColor: colors.borderBright },
  itemChevron: { marginLeft: spacing.xs },
  swipeContainer: { position: 'relative' },
  swipeBackdrop: {
    position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: radius.lg,
    backgroundColor: colors.danger, alignItems: 'flex-end', justifyContent: 'center',
    paddingRight: spacing.xl,
  },
  swipeDeleteBadge: { alignItems: 'center', gap: 1 },
  swipeDeleteLabel: { color: '#fff', fontSize: 8, fontWeight: '900', letterSpacing: 1.4 },
  itemIcon: {
    width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: colors.borderBright,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft,
  },
  itemIconDone: {
    borderColor: colors.success, backgroundColor: 'rgba(87, 242, 177, 0.08)',
  },
  itemBody: { flex: 1, gap: 3, minWidth: 0 },
  itemTypeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  itemType: { color: colors.primary, fontSize: 7, fontWeight: '800', letterSpacing: 1.2 },
  sharedBadge: {
    color: colors.success, fontSize: 7, fontWeight: '800', letterSpacing: 0.8,
    backgroundColor: 'rgba(87, 242, 177, 0.08)', paddingHorizontal: 5, paddingVertical: 2,
    borderRadius: radius.pill,
  },
  itemTypeLine: { width: 18, height: StyleSheet.hairlineWidth, backgroundColor: colors.borderBright },
  itemTitle: { color: colors.text, fontSize: font.sm, fontWeight: '700' },
  itemTitleDone: { color: colors.textMute, textDecorationLine: 'line-through' },
  itemSub: { color: colors.textFaint, fontSize: font.xs },
  alertModeButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    minWidth: 76, height: 28, paddingHorizontal: 9, borderWidth: 1, borderRadius: radius.pill,
    borderColor: colors.border, backgroundColor: 'rgba(68, 241, 255, 0.03)',
  },
  alertModeButtonAlarm: {
    borderColor: colors.warning, backgroundColor: 'rgba(255, 209, 102, 0.08)',
  },
  alertModeText: { color: colors.textFaint, fontSize: 7, fontWeight: '800', letterSpacing: 0.7 },
  alertModeTextAlarm: { color: colors.warning },
  alertControls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 6 },
  snoozeButton: {
    height: 28, paddingHorizontal: 10, borderWidth: 1, borderRadius: radius.pill,
    borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255, 209, 102, 0.035)',
  },
  snoozeText: { color: colors.textFaint, fontSize: 6, fontWeight: '700', letterSpacing: 0.35 },
  deleteButton: {
    width: 28, height: 28, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center',
  },
  deleteText: { color: colors.textFaint, fontSize: font.lg, lineHeight: 21 },
  rowActions: { gap: 5 },
  editButton: {
    width: 28, height: 28, borderWidth: 1, borderColor: colors.borderBright,
    borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  editText: { color: colors.primary, fontSize: font.md, lineHeight: 20 },
  promptPanel: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center',
    columnGap: spacing.sm, rowGap: spacing.xs, marginTop: spacing.sm, padding: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  promptLabel: {
    width: '100%', color: colors.textFaint, fontSize: 8, textAlign: 'center', letterSpacing: 1.4,
  },
  promptText: { color: colors.textMute, fontSize: font.xs },
  promptDivider: { color: colors.primaryDark, fontSize: font.xs },
  footer: { color: colors.textFaint, fontSize: 7, letterSpacing: 1, textAlign: 'center' },
  cleanSectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  cleanSectionTitle: { color: colors.text, fontSize: font.lg, fontWeight: '800' },
  seeAll: { color: colors.primary, fontSize: font.xs, fontWeight: '700' },
  screenTitle: { color: colors.text, fontSize: font.xl, fontWeight: '900' },
  screenSubtitle: { color: colors.textMute, fontSize: font.sm, marginTop: 4 },
  emptyState: { alignItems: 'center', gap: spacing.sm, paddingVertical: 70, paddingHorizontal: spacing.xl },
  emptyTitle: { color: colors.text, fontSize: font.lg, fontWeight: '800' },
  emptyText: { color: colors.textMute, fontSize: font.sm, textAlign: 'center', lineHeight: 20 },
  emptyButton: { marginTop: spacing.md, borderRadius: radius.md, backgroundColor: colors.primaryDark, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  emptyButtonText: { color: colors.onPrimary, fontSize: font.sm, fontWeight: '800' },
  settingsPage: { gap: spacing.xs, paddingBottom: spacing.lg },
  settingsSection: { color: colors.textMute, fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: spacing.xl, marginBottom: spacing.sm, marginLeft: spacing.xs },
  settingsGroup: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  settingsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 60, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  settingsRowPressed: { backgroundColor: colors.cardRaised },
  settingsRowDisabled: { opacity: 0.4 },
  settingsHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: spacing.md, paddingHorizontal: spacing.lg },
  settingsRowCopy: { flex: 1, minWidth: 0, gap: 2 },
  settingsRowLabel: { color: colors.text, fontSize: font.md, fontWeight: '600' },
  settingsRowLabelActive: { color: colors.primaryBright },
  settingsRowHint: { color: colors.textMute, fontSize: font.xs, lineHeight: 16 },
  settingsSep: { height: 1, backgroundColor: colors.border, marginLeft: 64 },
  settingsIconTile: { width: 34, height: 34, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  switchTrack: {
    width: 42, height: 24, borderRadius: 12, padding: 3, justifyContent: 'center',
    backgroundColor: colors.cardRaised, borderWidth: 1, borderColor: colors.borderBright,
  },
  switchTrackActive: { backgroundColor: colors.primaryDark, borderColor: colors.primary },
  switchThumb: { width: 16, height: 16, borderRadius: 8, backgroundColor: colors.textFaint },
  switchThumbActive: { backgroundColor: colors.primaryBright, alignSelf: 'flex-end' },
  segment: { flexDirection: 'row', gap: spacing.xs, backgroundColor: colors.cardRaised, borderRadius: radius.md, padding: spacing.xs, margin: spacing.md, marginTop: spacing.sm },
  segmentChip: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: radius.sm, borderWidth: 1, borderColor: 'transparent' },
  segmentChipActive: { backgroundColor: colors.primarySoft, borderColor: colors.primaryDark },
  segmentChipText: { color: colors.textMute, fontSize: font.sm, fontWeight: '700' },
  segmentChipTextActive: { color: colors.primaryBright },
  budgetBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginHorizontal: spacing.lg, marginTop: spacing.md, marginBottom: spacing.md,
    paddingVertical: 13, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.primaryDark, backgroundColor: colors.primarySoft,
  },
  budgetBtnDisconnect: { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
  budgetBtnText: { color: colors.primaryBright, fontSize: font.sm, fontWeight: '800', letterSpacing: 0.4 },
  budgetBtnTextDisconnect: { color: colors.danger },
  undoBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: '#16303A', borderTopWidth: 1, borderColor: colors.borderBright, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  undoText: { flex: 1, color: colors.text, fontSize: font.sm },
  undoAction: { color: colors.primary, fontSize: font.sm, fontWeight: '900' },
  bottomNav: { minHeight: 68, flexDirection: 'row', backgroundColor: colors.bgAlt, borderTopWidth: 1, borderColor: colors.border },
  navItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, position: 'relative' },
  navIconWrap: { position: 'relative', minWidth: 28, alignItems: 'center' },
  navLabel: { color: colors.textFaint, fontSize: font.xs, fontWeight: '700' },
  navLabelActive: { color: colors.primaryBright },
  navIndicator: { position: 'absolute', top: 0, width: 38, height: 2, borderRadius: 1, backgroundColor: colors.primary },
  navCount: { position: 'absolute', right: -5, top: -5, minWidth: 17, height: 17, borderRadius: 9, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  navCountText: { color: '#fff', fontSize: 8, fontWeight: '900' },
});

function ItemSpaceBadge({ spaceId }: { spaceId?: string | null }) {
  const spaces = useSpaces((state) => state.spaces);
  return <Text style={styles.sharedBadge}>{spaceLabel(spaceId, spaces)}</Text>;
}
