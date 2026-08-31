import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { colors, font, radius, spacing } from './src/theme';
import { isGroqConfigured } from './src/config';
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
import { bkkDateStr } from './src/lib/date';
import { CloudSyncPanel } from './src/components/CloudSyncPanel';

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

export default function App() {
  const engines = useMemo(() => getEngines(), []);
  const firstAvailable = engines.find((candidate) => candidate.available)?.id ?? engines[0]?.id ?? 'cloud';
  const [engine, setEngine] = useState<SttEngineId>(firstAvailable);
  const [last, setLast] = useState<TranscriptResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [plan, setPlan] = useState<BrainPlan | null>(null);

  const items = useStore((state) => state.items);
  const hasHydrated = useStore((state) => state.hasHydrated);
  const addItem = useStore((state) => state.addItem);
  const removeItem = useStore((state) => state.removeItem);
  const updateItem = useStore((state) => state.updateItem);
  const bootstrapSync = useStore((state) => state.bootstrapSync);

  // Short-lived conversation memory: what the user can refer to next turn
  // ("อันแรก" / "อันเมื่อกี้") + a pending utterance awaiting clarification.
  const contextRef = useRef<BrainContext>({ referents: [] });

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

      const needsPerm = p.actions.some(
        (a) => CREATE_TOOLS.includes(a.tool) || a.tool === 'update_item',
      );
      if (needsPerm) await ensureNotifyPermission();

      for (const action of p.actions) {
        if (CREATE_TOOLS.includes(action.tool)) {
          const item = actionToItem(action, rawText); // keep the verbatim sentence
          if (!item) continue;
          const ids = await scheduleForItem(item);
          const saved = { ...item, notificationIds: ids };
          addItem(saved);
          created.push(saved);
        } else if (action.tool === 'delete_item') {
          const target = snapshot().find((i) => i.id === action.target_ref);
          if (target) {
            await cancelNotifications(target.notificationIds);
            removeItem(target.id);
          }
        } else if (action.tool === 'update_item') {
          const target = snapshot().find((i) => i.id === action.target_ref);
          if (target) await applyUpdate(target, action);
        }
      }

      // Query answer is data-driven → wins over the plan's canned reply.
      const queryAction = p.actions.find((a) => a.tool === 'query');
      let answer = p.speak_back;
      if (queryAction) {
        answer =
          queryAction.query_kind === 'search'
            ? await searchMemory(queryAction.title || rawText, snapshot())
            : answerQuery(snapshot(), queryAction);
      }
      speak(answer);

      // Expense handoff last — it backgrounds this app.
      const expense = p.actions.find((a) => a.tool === 'record_expense' && a.amount != null);
      if (expense) {
        const date = bkkDateStr(expense.datetime ?? new Date());
        const res = await sendExpenseToDailyBudget({
          amount: expense.amount as number,
          note: expense.title,
          date,
        });
        if (!res.ok) speak('ยังเปิดแอปงบวันนี้ไม่ได้ครับ ติดตั้งแอปหรือยังครับ');
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
    [addItem, removeItem, applyUpdate],
  );

  const handleResult = useCallback(
    (result: TranscriptResult) => {
      setError(null);
      setLast(result);
      setPlan(null);

      if (!result.text) {
        speak('ไม่ได้ยินเสียงพูดเลยครับ');
        return;
      }
      if (!isGroqConfigured()) {
        speak(`คุณพูดว่า ${result.text}`);
        return;
      }

      setThinking(true);
      planActions(result.text, new Date(), contextRef.current)
        .then(async (parsed) => {
          setPlan(parsed);
          // Not confident enough — ask instead of guessing; next turn completes it.
          if (parsed.needs_clarification && parsed.clarify_question) {
            contextRef.current = { ...contextRef.current, pending: result.text };
            speak(parsed.clarify_question);
            return;
          }
          await executePlan(parsed, result.text);
        })
        .catch((caught: unknown) => {
          const message = caught instanceof Error ? caught.message : String(caught);
          setError(message);
          speak('ขอโทษครับ ประมวลผลไม่สำเร็จ');
        })
        .finally(() => setThinking(false));
    },
    [executePlan],
  );

  const handleDelete = useCallback(
    (item: Item) => {
      void cancelNotifications(item.notificationIds);
      removeItem(item.id);
    },
    [removeItem],
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
    ? 'กำลังถอดเสียง'
    : thinking
      ? 'กำลังวิเคราะห์'
      : listening
        ? 'กำลังฟังคุณ'
        : 'พร้อมรับคำสั่ง';

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <StatusBar style="light" />
        <HudBackdrop />
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <View style={styles.brandRow}>
              <View style={styles.brandMark}>
                <Text style={styles.brandLetter}>V</Text>
                <View style={styles.brandMarkDot} />
              </View>
              <View style={styles.brandCopy}>
                <Text style={styles.brand}>V.O.R.A.</Text>
                <Text style={styles.brandSub}>VOICE OPERATED REMINDER ASSISTANT</Text>
              </View>
              <View style={styles.onlineBadge}>
                <View style={styles.onlineDot} />
                <Text style={styles.onlineText}>ONLINE</Text>
              </View>
            </View>
            <View style={styles.headerRule}>
              <View style={styles.headerRuleBright} />
            </View>
          </View>

          <View style={styles.telemetry}>
            <TelemetryCell label="CORE" value={thinking ? 'PROCESSING' : 'STABLE'} />
            <View style={styles.telemetryDivider} />
            <TelemetryCell label="LANGUAGE" value="TH / AUTO" />
            <View style={styles.telemetryDivider} />
            <TelemetryCell label="MEMORY" value={`${items.length} ITEMS`} />
          </View>

          <View style={styles.hero}>
            <View style={styles.heroTitleRow}>
              <View style={styles.microLine} />
              <Text style={styles.heroEyebrow}>PERSONAL INTELLIGENCE CORE</Text>
              <View style={styles.microLine} />
            </View>
            <Text style={styles.coreStatus}>{coreStatus}</Text>
            <AICore
              listening={listening}
              busy={busy}
              thinking={thinking}
              onPress={toggle}
            />
            <Text style={[styles.coreHint, (listening || thinking) && styles.coreHintActive]}>
              {busy
                ? 'กำลังแปลงเสียงเป็นข้อความ...'
                : thinking
                  ? 'กำลังทำความเข้าใจและวางแผนให้คุณ...'
                  : listening
                    ? 'พูดได้เลย · แตะอีกครั้งเมื่อพูดจบ'
                    : 'แตะแกนกลางเพื่อเริ่มสนทนา'}
            </Text>
            {activeEngine && !activeEngine.available && (
              <View style={styles.warningPanel}>
                <Text style={styles.warningCode}>SYS.WARN</Text>
                <Text style={styles.warningText}>{activeEngine.unavailableReason}</Text>
              </View>
            )}
          </View>

          <View style={styles.enginePanel}>
            <View style={styles.panelCornerTopLeft} />
            <View style={styles.panelCornerBottomRight} />
            <Text style={styles.panelLabel}>VOICE PROCESSOR</Text>
            <View style={styles.engineToggle}>
              {engines.map((candidate) => {
                const selected = candidate.id === engine;
                return (
                  <Pressable
                    key={candidate.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected, disabled: !candidate.available }}
                    disabled={!candidate.available || listening || busy}
                    onPress={() => setEngine(candidate.id)}
                    style={({ pressed }) => [
                      styles.engineOption,
                      selected && styles.engineOptionSelected,
                      !candidate.available && styles.engineOptionDisabled,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={[styles.engineSignal, selected && styles.engineSignalSelected]} />
                    <View style={styles.engineCopy}>
                      <Text style={[styles.engineLabel, selected && styles.engineLabelSelected]}>
                        {candidate.label}
                      </Text>
                      <Text style={styles.engineHint} numberOfLines={1}>
                        {candidate.available ? candidate.hint : candidate.unavailableReason}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <CloudSyncPanel />

          <SectionHeader index="01" title="CONVERSATION STREAM" />
          <View style={styles.conversation}>
            {!last && !partial && !thinking && !plan && (
              <AssistantMessage text="สวัสดีครับ วันนี้ให้ผมช่วยจำหรือจัดการอะไรให้ดีครับ?" />
            )}

            {last && (
              <UserMessage
                text={last.text || '(ไม่พบข้อความ)'}
                meta={`${last.engine === 'cloud' ? 'CLOUD STT' : last.engine === 'device' ? 'ON-DEVICE STT' : 'BROWSER STT'} · ${last.elapsedMs} MS`}
                onReplay={last.text ? () => speak(last.text) : undefined}
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
                    <Text style={styles.thinkingText}>กำลังวิเคราะห์เจตนาและบริบท...</Text>
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
                        accessibilityLabel="พูดคำตอบซ้ำ"
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
              <AssistantMessage text="รับเสียงแล้วครับ ขณะนี้กำลังทำงานในโหมดทดสอบเสียง" />
            )}

            {error && (
              <View style={styles.errorPanel}>
                <Text style={styles.errorCode}>PROCESS INTERRUPTED</Text>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}
          </View>

          {hasHydrated && items.length > 0 && (
            <View style={styles.memorySection}>
              <SectionHeader index="02" title={`MEMORY ARCHIVE · ${items.length}`} />
              <View style={styles.itemList}>
                {items.map((item, index) => (
                  <ItemRow
                    key={item.id}
                    index={index + 1}
                    item={item}
                    onToggle={() => void handleToggleDone(item)}
                    onAlertModeChange={() => void handleAlertModeChange(item)}
                    onSnoozeMinutesChange={() => void handleSnoozeMinutesChange(item)}
                    onDelete={() => handleDelete(item)}
                  />
                ))}
              </View>
            </View>
          )}

          <View style={styles.promptPanel}>
            <Text style={styles.promptLabel}>TRY A VOICE COMMAND</Text>
            <Text style={styles.promptText}>“เตือนกินยาพรุ่งนี้ 9 โมง”</Text>
            <Text style={styles.promptDivider}>/</Text>
            <Text style={styles.promptText}>“วันนี้มีอะไรต้องทำบ้าง”</Text>
          </View>
          <Text style={styles.footer}>LOCAL-FIRST MEMORY · ASIA/BANGKOK · VORA SYSTEM 01</Text>
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
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
              accessibilityLabel="เล่นข้อความเสียงซ้ำ"
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
            accessibilityLabel={listening ? 'หยุดฟัง' : 'เริ่มพูด'}
            accessibilityRole="button"
            disabled={busy}
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
                <MicGlyph active={active} />
                <Text style={styles.coreButtonLabel}>
                  {thinking ? 'THINKING' : listening ? 'LISTENING' : 'TAP TO TALK'}
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

function MicGlyph({ active }: { active: boolean }) {
  return (
    <View style={styles.micGlyph}>
      <View style={[styles.micCapsule, active && styles.micCapsuleActive]}>
        <View style={styles.micCapsuleLine} />
      </View>
      <View style={styles.micShoulder} />
      <View style={styles.micStem} />
      <View style={styles.micBase} />
    </View>
  );
}

const TYPE_META: Record<Item['type'], { icon: string; label: string }> = {
  reminder: { icon: '◴', label: 'REMINDER' },
  event: { icon: '◇', label: 'EVENT' },
  todo: { icon: '☑', label: 'TODO' },
  note: { icon: '≡', label: 'NOTE' },
};

/** Build the referable-items list the brain uses to resolve "อันแรก" etc.
 *  Includes the raw ISO start so the model can edit time while keeping the day. */
function toReferents(items: Item[]): Referent[] {
  return items.slice(0, 8).map((item) => {
    const when = formatDateTime(item.start_at, item.all_day);
    const iso = item.start_at ? ` {${item.start_at}}` : '';
    const mode =
      item.type === 'reminder'
        ? ` [${
            item.remind_until_done
              ? 'ปลุกจนกว่าจะทำ'
              : item.alert_mode === 'alarm'
                ? 'นาฬิกาปลุก'
                : 'แจ้งเตือน'
          }]`
        : '';
    return { ref: item.id, label: `${item.title}${when ? ` — ${when}` : ''}${mode}${iso}` };
  });
}

function ItemRow({
  item,
  index,
  onToggle,
  onAlertModeChange,
  onSnoozeMinutesChange,
  onDelete,
}: {
  item: Item;
  index: number;
  onToggle: () => void;
  onAlertModeChange: () => void;
  onSnoozeMinutesChange: () => void;
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
    <View style={[styles.itemRow, item.done && styles.itemRowDone]}>
      <Text style={styles.itemIndex}>{String(index).padStart(2, '0')}</Text>
      <Pressable
        accessibilityLabel={item.done ? `ยกเลิกสถานะเสร็จของ ${item.title}` : `ทำ ${item.title} เสร็จ`}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: item.done }}
        hitSlop={8}
        onPress={onToggle}
        style={[styles.itemIcon, item.done && styles.itemIconDone]}
      >
        <Text style={styles.itemIconText}>{item.done ? '✓' : meta.icon}</Text>
      </Pressable>
      <View style={styles.itemBody}>
        <View style={styles.itemTypeRow}>
          <Text style={styles.itemType}>{meta.label}</Text>
          <View style={styles.itemTypeLine} />
        </View>
        <Text style={[styles.itemTitle, item.done && styles.itemTitleDone]} numberOfLines={1}>
          {item.title}
        </Text>
        {!!detail && <Text style={styles.itemSub}>{detail}</Text>}
      </View>
      {item.type === 'reminder' && (
        <View style={styles.alertControls}>
          <Pressable
            accessibilityLabel={`เปลี่ยนรูปแบบการเตือนของ ${item.title}`}
            accessibilityHint="วนระหว่างแจ้งเตือน นาฬิกาปลุก และปลุกจนกว่าจะทำ"
            accessibilityRole="button"
            hitSlop={8}
            onPress={onAlertModeChange}
            style={[
              styles.alertModeButton,
              item.alert_mode === 'alarm' && styles.alertModeButtonAlarm,
            ]}
          >
            <Text
              style={[
                styles.alertModeText,
                item.alert_mode === 'alarm' && styles.alertModeTextAlarm,
              ]}
            >
              {item.remind_until_done
                ? '🔁 UNTIL DONE'
                : item.alert_mode === 'alarm'
                  ? '⏰ ALARM'
                  : '🔔 NOTIFY'}
            </Text>
          </Pressable>
          {item.alert_mode === 'alarm' && (
            <Pressable
              accessibilityLabel={`เปลี่ยนเวลาเลื่อนปลุกของ ${item.title}`}
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
      <Pressable
        accessibilityLabel={`ลบ ${item.title}`}
        accessibilityRole="button"
        hitSlop={10}
        onPress={onDelete}
        style={styles.deleteButton}
      >
        <Text style={styles.deleteText}>×</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
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
    paddingBottom: spacing.xl, gap: spacing.lg,
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
  brandMarkDot: {
    position: 'absolute', width: 4, height: 4, backgroundColor: colors.primary, top: 3, right: 3,
  },
  brandCopy: { flex: 1, marginLeft: spacing.lg, gap: 2 },
  brand: { color: colors.text, fontSize: font.lg, fontWeight: '800', letterSpacing: 4 },
  brandSub: { color: colors.textFaint, fontSize: 8, letterSpacing: 1.25 },
  onlineBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1,
    borderColor: colors.border, backgroundColor: 'rgba(87, 242, 177, 0.04)',
    paddingHorizontal: spacing.sm, paddingVertical: 6,
  },
  onlineDot: {
    width: 5, height: 5, borderRadius: radius.pill, backgroundColor: colors.success,
    shadowColor: colors.success, shadowOpacity: 0.8, shadowRadius: 5,
  },
  onlineText: { color: colors.success, fontSize: 8, fontWeight: '800', letterSpacing: 1.2 },
  headerRule: { height: 1, backgroundColor: colors.border },
  headerRuleBright: { width: 72, height: 1, backgroundColor: colors.primary },
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
  coreStatus: {
    color: colors.primaryBright, fontSize: font.xl, fontWeight: '300', letterSpacing: 1.5,
    marginTop: spacing.sm,
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
  micGlyph: { width: 38, height: 47, alignItems: 'center' },
  micCapsule: {
    width: 21, height: 30, borderRadius: 11, borderWidth: 1.5,
    borderColor: colors.textMute, alignItems: 'center', paddingTop: 6,
  },
  micCapsuleActive: { borderColor: colors.primaryBright },
  micCapsuleLine: { width: 7, height: 1, backgroundColor: colors.primary },
  micShoulder: {
    position: 'absolute', top: 16, width: 31, height: 20,
    borderLeftWidth: 1.5, borderRightWidth: 1.5, borderBottomWidth: 1.5,
    borderColor: colors.primary, borderBottomLeftRadius: 15, borderBottomRightRadius: 15,
  },
  micStem: { width: 1.5, height: 7, backgroundColor: colors.primary },
  micBase: { width: 16, height: 1.5, backgroundColor: colors.primary },
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
  engineToggle: { flexDirection: 'row', gap: spacing.sm },
  engineOption: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minWidth: 0,
    padding: spacing.sm, borderWidth: 1, borderColor: 'transparent',
    backgroundColor: 'rgba(255, 255, 255, 0.015)',
  },
  engineOptionSelected: { borderColor: colors.borderBright, backgroundColor: colors.primarySoft },
  engineOptionDisabled: { opacity: 0.35 },
  engineSignal: {
    width: 7, height: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.textFaint,
  },
  engineSignalSelected: {
    backgroundColor: colors.primary, borderColor: colors.primaryBright,
    shadowColor: colors.primary, shadowOpacity: 0.8, shadowRadius: 5,
  },
  engineCopy: { flex: 1, minWidth: 0, gap: 2 },
  engineLabel: { color: colors.textMute, fontSize: font.xs, fontWeight: '700' },
  engineLabelSelected: { color: colors.primaryBright },
  engineHint: { color: colors.textFaint, fontSize: 8 },
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
    backgroundColor: 'rgba(6, 22, 30, 0.88)', borderWidth: 1,
    borderColor: colors.border, padding: spacing.md,
  },
  itemRowDone: { opacity: 0.48 },
  itemIndex: { color: colors.textFaint, fontSize: 8, width: 16 },
  itemIcon: {
    width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: colors.borderBright,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft,
  },
  itemIconDone: {
    borderColor: colors.success, backgroundColor: 'rgba(87, 242, 177, 0.08)',
  },
  itemIconText: { color: colors.primaryBright, fontSize: font.md },
  itemBody: { flex: 1, gap: 3, minWidth: 0 },
  itemTypeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  itemType: { color: colors.primary, fontSize: 7, fontWeight: '800', letterSpacing: 1.2 },
  itemTypeLine: { width: 18, height: StyleSheet.hairlineWidth, backgroundColor: colors.borderBright },
  itemTitle: { color: colors.text, fontSize: font.sm, fontWeight: '700' },
  itemTitleDone: { color: colors.textMute, textDecorationLine: 'line-through' },
  itemSub: { color: colors.textFaint, fontSize: font.xs },
  alertModeButton: {
    minWidth: 76, height: 28, paddingHorizontal: 7, borderWidth: 1,
    borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(68, 241, 255, 0.03)',
  },
  alertModeButtonAlarm: {
    borderColor: colors.warning, backgroundColor: 'rgba(255, 209, 102, 0.08)',
  },
  alertModeText: { color: colors.textFaint, fontSize: 7, fontWeight: '800', letterSpacing: 0.7 },
  alertModeTextAlarm: { color: colors.warning },
  alertControls: { alignItems: 'stretch', gap: 4 },
  snoozeButton: {
    minWidth: 76, height: 20, paddingHorizontal: 5, borderWidth: 1,
    borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255, 209, 102, 0.035)',
  },
  snoozeText: { color: colors.textFaint, fontSize: 6, fontWeight: '700', letterSpacing: 0.35 },
  deleteButton: {
    width: 28, height: 28, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  deleteText: { color: colors.textFaint, fontSize: font.lg, lineHeight: 21 },
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
});
