import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  Easing,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { colors, font, radius, spacing } from './src/theme';
import { config, isGroqConfigured, isBudgetApiConfigured } from './src/config';
import { getEngines } from './src/speech/engines';
import { useVoiceInput } from './src/speech/useVoiceInput';
import { speak } from './src/speech/tts';
import type { SttEngineId, TranscriptResult } from './src/speech/types';
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
import { CloudSyncPanel } from './src/components/CloudSyncPanel';
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
type AppTab = 'talk' | 'items' | 'settings';
interface PendingBulkDelete {
  itemIds: string[];
  description: string;
}

export default function App() {
  const engines = useMemo(() => getEngines(), []);
  const preferredEngine = usePreferences((state) => state.preferredEngine);
  const setPreferredEngine = usePreferences((state) => state.setPreferredEngine);
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
  const [last, setLast] = useState<TranscriptResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [plan, setPlan] = useState<BrainPlan | null>(null);
  const [budgetConnected, setBudgetConnected] = useState(false);
  const [budgetBusy, setBudgetBusy] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Item | null>(null);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingBulkDeleteRef = useRef<PendingBulkDelete | null>(null);

  const items = useStore((state) => state.items);
  const userId = useStore((state) => state.userId);
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
    if (!preferredEngine) return;
    const preferred = engines.find(
      (candidate) => candidate.id === preferredEngine && candidate.available,
    );
    if (preferred) setEngine(preferred.id);
  }, [engines, preferredEngine]);

  useEffect(
    () => () => {
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    },
    [],
  );

  const syncNativeCompletions = useCallback(async () => {
    const completedIds = await consumeCompletedNativeAlarmItemIds();
    if (!completedIds.length) return;
    const completed = new Set(completedIds);
    for (const item of useStore.getState().items) {
      if (!completed.has(item.id) || item.done) continue;
      await cancelNotifications(item.notificationIds);
      updateItem(item.id, { done: true, notificationIds: [] });
    }
  }, [updateItem]);

  useEffect(() => {
    void initNotifications();
    void syncNativeCompletions();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void syncNativeCompletions();
    });
    return () => subscription.remove();
  }, [syncNativeCompletions]);

  useEffect(() => {
    if (hasHydrated) void bootstrapSync();
  }, [bootstrapSync, hasHydrated]);

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
      if (action.done != null) patch.done = action.done;

      const timingChanged =
        patch.start_at !== undefined ||
        patch.recurrence !== undefined ||
        patch.alert_mode !== undefined ||
        patch.remind_until_done !== undefined ||
        patch.snooze_minutes !== undefined ||
        patch.max_attempts !== undefined ||
        patch.done !== undefined;
      if (timingChanged) {
        await cancelNotifications(target.notificationIds);
        patch.notificationIds = await scheduleForItem({ ...target, ...patch });
      }
      updateItem(target.id, patch);
    },
    [updateItem],
  );

  // Carry out every action in a plan, then speak one reply.
  const executePlan = useCallback(
    async (p: BrainPlan, rawText: string) => {
      const CREATE_TOOLS = ['create_reminder', 'create_event', 'create_todo', 'create_note'];
      const snapshot = () => useStore.getState().items;
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
          return formatBudgetAnswer(summary, kind ?? 'summary');
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

      const needsPerm = p.actions.some(
        (a) => CREATE_TOOLS.includes(a.tool) || a.tool === 'update_item',
      );
      if (needsPerm) await ensureNotifyPermission();

      for (const action of p.actions) {
        if (CREATE_TOOLS.includes(action.tool)) {
          const item = actionToItem(
            action,
            rawText,
            defaultAlertMode,
            userId ? activeHouseholdId : null,
          ); // keep the verbatim sentence
          if (!item) continue;
          const ids = await scheduleForItem(item);
          const saved = { ...item, notificationIds: ids };
          addItem(saved);
          created.push(saved);
        } else if (action.tool === 'delete_item') {
          requestedSingleDeletes += 1;
          const target = snapshot().find((i) => i.id === action.target_ref);
          if (target) {
            await cancelNotifications(target.notificationIds);
            removeItem(target.id);
            completedSingleDeletes += 1;
          }
        } else if (action.tool === 'update_item') {
          const target = snapshot().find((i) => i.id === action.target_ref);
          if (target) await applyUpdate(target, action);
        }
      }

      // Query answer is data-driven → wins over the plan's canned reply.
      const queryAction = p.actions.find((a) => a.tool === 'query');
      let answer = p.speak_back;
      if (requestedSingleDeletes > 0 && completedSingleDeletes === 0) {
        answer = 'I could not find that item. Try saying its name or list your items first.';
      } else if (completedSingleDeletes > 0) {
        answer = `Deleted ${completedSingleDeletes} ${completedSingleDeletes === 1 ? 'item' : 'items'}.`;
      }
      if (queryAction) {
        answer =
          queryAction.query_kind === 'search'
            ? await searchMemory(queryAction.title || rawText, snapshot())
            : answerQuery(snapshot(), queryAction);
      }

      // ── daily-budget actions (REST bridge) ────────────────────────────────
      // Budget answers and expense confirmations are data-driven, so they
      // override the plan's canned speak_back. A deep-link handoff (record
      // only, when the API isn't configured) is deferred until after we speak,
      // because it backgrounds this app.
      let deferredDeepLinkExpense: BrainPlan['actions'][number] | null = null;

      const budgetQuery = p.actions.find((a) => a.tool === 'query_budget');
      if (budgetQuery) {
        answer = await answerBudgetQuery(budgetQuery.budget_kind);
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

      speak(answer);

      if (deferredDeepLinkExpense) {
        const date = bkkDateStr(deferredDeepLinkExpense.datetime ?? new Date());
        const res = await sendExpenseToDailyBudget({
          amount: deferredDeepLinkExpense.amount as number,
          note: deferredDeepLinkExpense.title,
          date,
        });
        if (!res.ok) speak('I could not open Daily Budget. Please check that it is installed.');
      }

      // Refresh what "อันแรก / อันเมื่อกี้" points at for the next turn.
      let refItems: Item[];
      if (queryAction && queryAction.query_kind !== 'search') {
        refItems = queryItems(snapshot(), queryAction);
      } else if (created.length) {
        refItems = created;
      } else {
        refItems = [...snapshot()].sort((a, b) => b.created_at.localeCompare(a.created_at));
      }
      contextRef.current = { referents: toReferents(refItems), lastUtterance: rawText };
    },
    [activeHouseholdId, addItem, applyUpdate, defaultAlertMode, removeItem, userId],
  );

  const executeConfirmedBulkDelete = useCallback(
    async (pending: PendingBulkDelete) => {
      const ids = new Set(pending.itemIds);
      const targets = useStore.getState().items.filter((item) => ids.has(item.id));
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
      speak(answer);
    },
    [removeItem],
  );

  const handleResult = useCallback(
    (result: TranscriptResult) => {
      setError(null);
      setLast(result);
      setPlan(null);

      if (!result.text) {
        speak('I did not hear anything. Please try again.');
        return;
      }

      const pendingBulk = pendingBulkDeleteRef.current;
      if (pendingBulk) {
        if (isDeleteConfirmation(result.text)) {
          pendingBulkDeleteRef.current = null;
          setThinking(true);
          void executeConfirmedBulkDelete(pendingBulk)
            .catch((caught: unknown) => {
              const message = caught instanceof Error ? caught.message : String(caught);
              setError(message);
              speak('Sorry, I could not delete those items.');
            })
            .finally(() => setThinking(false));
          return;
        }
        if (isDeleteCancellation(result.text)) {
          pendingBulkDeleteRef.current = null;
          const answer = 'Delete cancelled.';
          setPlan({ actions: [], speak_back: answer, needs_clarification: false, clarify_question: null });
          speak(answer);
          return;
        }
        const question = `Nothing was deleted. To delete ${pendingBulk.description}, say “confirm”.`;
        setPlan({ actions: [], speak_back: question, needs_clarification: true, clarify_question: question });
        speak(question);
        return;
      }

      const currentItems = useStore.getState().items;
      const localDelete = planLocalDelete(result.text, currentItems, contextRef.current.referents);
      if (!localDelete && !isGroqConfigured()) {
        speak(`You said: ${result.text}`);
        return;
      }

      setThinking(true);
      const inventory = toReferents(currentItems, 200);
      const planning = localDelete
        ? Promise.resolve(localDelete)
        : planActions(result.text, new Date(), { ...contextRef.current, inventory });
      planning
        .then(async (parsed) => {
          const currentItems = useStore.getState().items;
          const resolvedPlan: BrainPlan = {
            ...parsed,
            actions: parsed.actions.map((action) => {
              if (action.tool !== 'delete_item') return action;
              const refExists = currentItems.some((item) => item.id === action.target_ref);
              if (refExists) return action;
              const fallback = resolveDeleteTarget(action.title, currentItems);
              return fallback ? { ...action, target_ref: fallback.id } : action;
            }),
          };
          setPlan(resolvedPlan);
          // Not confident enough — ask instead of guessing; next turn completes it.
          if (resolvedPlan.needs_clarification && resolvedPlan.clarify_question) {
            contextRef.current = { ...contextRef.current, pending: result.text };
            speak(resolvedPlan.clarify_question);
            return;
          }

          const bulkAction = resolvedPlan.actions.find((action) => action.tool === 'delete_items');
          const enumeratedDeletes = resolvedPlan.actions.filter(
            (action) => action.tool === 'delete_item' && !!action.target_ref,
          );
          const candidates = bulkAction
            ? itemsForDeleteScope(useStore.getState().items, bulkAction.delete_scope)
            : enumeratedDeletes.length > 1
              ? useStore
                  .getState()
                  .items.filter((item) =>
                    enumeratedDeletes.some((action) => action.target_ref === item.id),
                  )
              : [];
          if (bulkAction || enumeratedDeletes.length > 1) {
            if (!candidates.length) {
              const answer = bulkAction?.delete_scope
                ? `I could not find ${deleteScopeLabel(bulkAction.delete_scope)}.`
                : 'I could not find the items you wanted to delete.';
              setPlan({ ...resolvedPlan, speak_back: answer, needs_clarification: false, clarify_question: null });
              speak(answer);
              return;
            }
            const description = bulkAction?.delete_scope
              ? deleteScopeLabel(bulkAction.delete_scope)
              : `${candidates.length} selected items`;
            const question = `I found ${candidates.length} ${candidates.length === 1 ? 'item' : 'items'}. To delete ${description}, say “confirm”.`;
            pendingBulkDeleteRef.current = {
              itemIds: candidates.map((item) => item.id),
              description,
            };
            setPlan({ ...resolvedPlan, speak_back: question, needs_clarification: true, clarify_question: question });
            speak(question);
            return;
          }
          await executePlan(resolvedPlan, result.text);
        })
        .catch((caught: unknown) => {
          const message = caught instanceof Error ? caught.message : String(caught);
          setError(message);
          speak('Sorry, I could not process that request.');
        })
        .finally(() => setThinking(false));
    },
    [executeConfirmedBulkDelete, executePlan],
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
      updateItem(item.id, { ...patch, notificationIds });
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
      updateItem(item.id, { ...patch, notificationIds });
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
      updateItem(item.id, { snooze_minutes, notificationIds });
    },
    [updateItem],
  );

  const handleToggleDone = useCallback(
    async (item: Item) => {
      if (!item.done) {
        await cancelNotifications(item.notificationIds);
        updateItem(item.id, { done: true, notificationIds: [] });
        return;
      }
      await ensureNotifyPermission();
      const next = { ...item, done: false };
      const notificationIds = await scheduleForItem(next);
      updateItem(item.id, { done: false, notificationIds });
    },
    [updateItem],
  );

  const handleError = useCallback((message: string) => setError(message), []);

  const { status, partial, toggle } = useVoiceInput({
    engine,
    onResult: handleResult,
    onError: handleError,
  });

  const listening = status === 'listening';
  const busy = status === 'transcribing';
  const activeEngine = engines.find((candidate) => candidate.id === engine);
  const coreStatus = busy
    ? 'TRANSCRIBING'
    : thinking
      ? 'PROCESSING'
      : listening
        ? 'LISTENING'
        : 'READY FOR COMMAND';
  const visibleItems = items.filter((item) => item.id !== pendingDelete?.id);
  const recentItems = visibleItems.slice(0, 3);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <StatusBar style="light" />
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <View style={styles.brandRow}>
              <View style={styles.brandMark}>
                <Text style={styles.brandLetter}>V</Text>
              </View>
              <View style={styles.brandCopy}>
                <Text style={styles.brand}>VORA</Text>
                <Text style={styles.brandSub}>VOICE OPERATED REMINDER ASSISTANT</Text>
              </View>
            </View>
            <View style={styles.headerRule} />
          </View>

          {activeTab === 'talk' && (
            <>
              <View style={styles.hero}>
                <View style={styles.coreStatusSlot}>
                  {(listening || busy || thinking) && (
                    <Text style={styles.coreStatus}>{coreStatus}</Text>
                  )}
                </View>
                <AICore listening={listening} busy={busy} thinking={thinking} onPress={toggle} />
                {activeEngine && !activeEngine.available && (
                  <View style={styles.warningPanel}>
                    <Text style={styles.warningText}>{activeEngine.unavailableReason}</Text>
                  </View>
                )}
              </View>

              <View style={styles.conversation}>
                {!last && !partial && !thinking && !plan && (
                  <AssistantMessage text="What would you like me to remember?" />
                )}

                {last && (
                  <UserMessage
                    text={last.text || '(No transcript)'}
                    meta={`${last.engine === 'cloud' ? 'CLOUD STT' : last.engine === 'device' ? 'ON-DEVICE STT' : 'BROWSER STT'} · ${last.elapsedMs} MS`}
                    onReplay={last.text ? () => speak(last.text, { language: config.locale }) : undefined}
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
                          speak(
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
                        ? `❓ ${plan.clarify_question}`
                        : plan.speak_back}
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

          {activeTab === 'settings' && (
            <View style={styles.settingsPage}>
              <View>
                <Text style={styles.screenTitle}>Settings</Text>
                <Text style={styles.screenSubtitle}>Voice, alerts, account, and sharing</Text>
              </View>

              <Text style={styles.settingsSection}>ALERTS</Text>
              <View style={styles.settingsGroup}>
                <View style={styles.settingsHeaderRow}>
                  <Ionicons name="notifications-outline" size={20} color={colors.textMute} />
                  <View style={styles.settingsRowCopy}>
                    <Text style={styles.settingsRowLabel}>Default alert</Text>
                    <Text style={styles.settingsRowHint}>Used when a command doesn't specify one</Text>
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

              <Text style={styles.settingsSection}>VOICE PROCESSOR</Text>
              <View style={styles.settingsGroup}>
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
                        <Ionicons name="mic-outline" size={20} color={selected ? colors.primary : colors.textMute} />
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
                  <Text style={styles.settingsSection}>DAILY BUDGET</Text>
                  <View style={styles.settingsGroup}>
                    <View style={styles.settingsHeaderRow}>
                      <Ionicons
                        name={budgetConnected ? 'wallet' : 'wallet-outline'}
                        size={20}
                        color={budgetConnected ? colors.primary : colors.textMute}
                      />
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

              <CloudSyncPanel />
              <HouseholdPanel />
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
  const name =
    id === 'talk'
      ? active
        ? 'mic'
        : 'mic-outline'
      : id === 'items'
        ? active
          ? 'list'
          : 'list-outline'
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
  onPress,
}: {
  listening: boolean;
  busy: boolean;
  thinking: boolean;
  onPress: () => void;
}) {
  const rotation = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(1)).current;
  const active = listening || busy || thinking;

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
            accessibilityLabel={listening ? 'Stop listening' : 'Start talking'}
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
                  {thinking ? 'THINKING' : listening ? 'TAP TO STOP' : 'TAP TO TALK'}
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
  onToggle,
  onAlertModeChange,
  onSnoozeMinutesChange,
  onEdit,
  onDelete,
}: {
  item: Item;
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

  return (
    <SwipeableRow onDelete={onDelete}>
      <Pressable
        accessibilityLabel={`Edit ${item.title}`}
        accessibilityHint="Opens the editor. Swipe left to delete."
        android_ripple={{ color: colors.primarySoft }}
        onPress={onEdit}
        style={({ pressed }) => [
          styles.itemRow,
          item.done && styles.itemRowDone,
          pressed && styles.itemRowPressed,
        ]}
      >
        <Pressable
          accessibilityLabel={item.done ? `Mark ${item.title} as not done` : `Mark ${item.title} as done`}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: item.done }}
          hitSlop={10}
          onPress={onToggle}
          style={[styles.itemIcon, item.done && styles.itemIconDone]}
        >
          <Ionicons
            name={item.done ? 'checkmark' : meta.icon}
            size={18}
            color={item.done ? colors.success : colors.primaryBright}
          />
        </Pressable>
        <View style={styles.itemBody}>
          <View style={styles.itemTypeRow}>
            <Text style={styles.itemType}>{meta.label}</Text>
            {!!item.household_id && <Text style={styles.sharedBadge}>SHARED</Text>}
          </View>
          <Text style={[styles.itemTitle, item.done && styles.itemTitleDone]} numberOfLines={1}>
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

/** Native-feeling row: tap opens the editor, swipe left past the threshold
 *  deletes (routing through the same undo bar as the button did). Built on
 *  PanResponder + Animated so it needs no gesture-handler dependency and works
 *  on web too. Only claims horizontal drags, leaving vertical scroll to the list. */
function SwipeableRow({ onDelete, children }: { onDelete: () => void; children: ReactNode }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const onDeleteRef = useRef(onDelete);
  onDeleteRef.current = onDelete;

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, g) =>
        Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 1.6,
      onPanResponderMove: (_evt, g) => {
        translateX.setValue(Math.max(-160, Math.min(0, g.dx)));
      },
      onPanResponderRelease: (_evt, g) => {
        const shouldDelete = g.dx < -96 || g.vx < -0.55;
        if (shouldDelete) {
          Animated.timing(translateX, {
            toValue: -600,
            duration: 200,
            easing: Easing.in(Easing.ease),
            useNativeDriver: true,
          }).start(() => onDeleteRef.current());
        } else {
          Animated.spring(translateX, {
            toValue: 0,
            bounciness: 6,
            useNativeDriver: true,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
      },
    }),
  ).current;

  const backdropOpacity = translateX.interpolate({
    inputRange: [-96, -32, 0],
    outputRange: [1, 0.5, 0],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.swipeContainer}>
      <Animated.View
        pointerEvents="none"
        style={[styles.swipeBackdrop, { opacity: backdropOpacity }]}
      >
        <View style={styles.swipeDeleteBadge}>
          <Ionicons name="trash-outline" size={22} color="#fff" />
          <Text style={styles.swipeDeleteLabel}>DELETE</Text>
        </View>
      </Animated.View>
      <Animated.View style={{ transform: [{ translateX }] }} {...pan.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
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
  header: { gap: spacing.md },
  brandRow: { flexDirection: 'row', alignItems: 'center' },
  brandMark: {
    width: 42, height: 42, borderWidth: 1, borderColor: colors.primary,
    alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '45deg' }],
    shadowColor: colors.primary, shadowOpacity: 0.3, shadowRadius: 8,
  },
  brandLetter: {
    color: colors.primaryBright, fontSize: font.lg, fontWeight: '300',
    transform: [{ rotate: '-45deg' }],
  },
  brandCopy: { flex: 1, marginLeft: spacing.lg, gap: 3 },
  brand: { color: colors.text, fontSize: font.xl, fontWeight: '800', letterSpacing: 6 },
  brandSub: { color: colors.textFaint, fontSize: 8, letterSpacing: 1.25 },
  headerRule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
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
  settingsPage: { gap: spacing.xs },
  settingsSection: { color: colors.textFaint, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginTop: spacing.lg, marginBottom: spacing.sm, marginLeft: spacing.xs },
  settingsGroup: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  settingsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 58, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  settingsRowPressed: { backgroundColor: colors.cardRaised },
  settingsRowDisabled: { opacity: 0.4 },
  settingsHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: spacing.md, paddingHorizontal: spacing.lg },
  settingsRowCopy: { flex: 1, minWidth: 0, gap: 2 },
  settingsRowLabel: { color: colors.text, fontSize: font.md, fontWeight: '600' },
  settingsRowLabelActive: { color: colors.primaryBright },
  settingsRowHint: { color: colors.textMute, fontSize: font.xs, lineHeight: 16 },
  settingsSep: { height: 1, backgroundColor: colors.border, marginLeft: 52 },
  segment: { flexDirection: 'row', gap: spacing.xs, backgroundColor: colors.cardRaised, borderRadius: radius.md, padding: spacing.xs, margin: spacing.md, marginTop: spacing.sm },
  segmentChip: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: radius.sm, borderWidth: 1, borderColor: 'transparent' },
  segmentChipActive: { backgroundColor: colors.primarySoft, borderColor: colors.primaryDark },
  segmentChipText: { color: colors.textMute, fontSize: font.sm, fontWeight: '700' },
  segmentChipTextActive: { color: colors.primaryBright },
  budgetBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: spacing.md, paddingVertical: 12, borderRadius: radius.sm,
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
