import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
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
import { parseIntent } from './src/brain/parseIntent';
import { brainToItem } from './src/brain/toItem';
import { describeBrain, intentLabel, formatDateTime, formatRecurrence } from './src/brain/format';
import type { BrainResult } from './src/brain/types';
import { useStore } from './src/store/useStore';
import { answerQuery } from './src/store/query';
import type { Item } from './src/store/types';
import { initNotifications, ensureNotifyPermission } from './src/notify/setup';
import { scheduleForItem, cancelNotifications } from './src/notify/scheduler';
import { sendExpenseToDailyBudget } from './src/integrations/dailyBudget';
import { bkkDateStr } from './src/lib/date';

export default function App() {
  const engines = useMemo(() => getEngines(), []);
  const firstAvailable = engines.find((e) => e.available)?.id ?? 'cloud';
  const [engine, setEngine] = useState<SttEngineId>(firstAvailable);
  const [last, setLast] = useState<TranscriptResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [brain, setBrain] = useState<BrainResult | null>(null);

  const items = useStore((s) => s.items);
  const hasHydrated = useStore((s) => s.hasHydrated);
  const addItem = useStore((s) => s.addItem);
  const removeItem = useStore((s) => s.removeItem);
  const toggleDone = useStore((s) => s.toggleDone);

  // Notification handler + Android channel, once.
  useEffect(() => {
    void initNotifications();
  }, []);

  // Persist a create_* intent and schedule its notifications.
  const saveIntent = useCallback(
    async (result: BrainResult) => {
      const item = brainToItem(result);
      if (!item) return;
      await ensureNotifyPermission();
      const ids = await scheduleForItem(item);
      addItem({ ...item, notificationIds: ids });
    },
    [addItem],
  );

  const handleResult = useCallback(
    (r: TranscriptResult) => {
      setError(null);
      setLast(r);
      setBrain(null);

      if (!r.text) {
        speak('ไม่ได้ยินเสียงพูดเลยครับ');
        return;
      }
      // Without a Groq key there's no brain — fall back to echoing (Phase 0).
      if (!isGroqConfigured()) {
        speak(`คุณพูดว่า ${r.text}`);
        return;
      }

      setThinking(true);
      parseIntent(r.text)
        .then(async (result) => {
          setBrain(result);
          if (
            result.intent === 'create_reminder' ||
            result.intent === 'create_event' ||
            result.intent === 'create_note'
          ) {
            await saveIntent(result); // Phase 2: store + schedule
            speak(result.speak_back);
          } else if (result.intent === 'query') {
            // Read the freshest store snapshot to answer.
            const answer = answerQuery(useStore.getState().items, result);
            speak(answer);
          } else if (result.intent === 'add_expense' && result.amount != null) {
            // Phase 4: hand off to the daily-budget app (deep link).
            speak(result.speak_back);
            const date = bkkDateStr(result.datetime ?? new Date());
            const res = await sendExpenseToDailyBudget({
              amount: result.amount,
              note: result.title,
              date,
            });
            if (!res.ok) speak('ยังเปิดแอปงบวันนี้ไม่ได้ครับ ติดตั้งแอปหรือยังครับ');
          } else {
            // unknown / add_expense without amount — just acknowledge.
            speak(result.speak_back);
          }
        })
        .catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          setError(msg);
          speak('ขอโทษครับ ประมวลผลไม่สำเร็จ');
        })
        .finally(() => setThinking(false));
    },
    [saveIntent],
  );

  const handleDelete = useCallback(
    (item: Item) => {
      void cancelNotifications(item.notificationIds);
      removeItem(item.id);
    },
    [removeItem],
  );

  const handleError = useCallback((message: string) => setError(message), []);

  const { status, partial, toggle } = useVoiceInput({
    engine,
    onResult: handleResult,
    onError: handleError,
  });

  const listening = status === 'listening';
  const busy = status === 'transcribing';
  const activeEngine = engines.find((e) => e.id === engine);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.title}>🎙️ Voice Reminder</Text>
          <Text style={styles.subtitle}>พูด → เข้าใจ → บันทึก & เตือน</Text>
        </View>

        {/* Engine toggle */}
        <View style={styles.toggleRow}>
          {engines.map((e) => {
            const selected = e.id === engine;
            return (
              <Pressable
                key={e.id}
                disabled={!e.available || listening || busy}
                onPress={() => setEngine(e.id)}
                style={[
                  styles.toggle,
                  selected && styles.toggleSelected,
                  !e.available && styles.toggleDisabled,
                ]}
              >
                <Text style={[styles.toggleLabel, selected && styles.toggleLabelSelected]}>
                  {e.label}
                </Text>
                <Text style={styles.toggleHint} numberOfLines={2}>
                  {e.available ? e.hint : e.unavailableReason}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Mic button */}
        <View style={styles.micWrap}>
          <MicButton listening={listening} busy={busy} onPress={toggle} />
          <Text style={styles.statusText}>
            {busy
              ? 'กำลังถอดเสียง…'
              : listening
                ? 'กำลังฟัง — แตะอีกครั้งเพื่อหยุด'
                : 'แตะเพื่อเริ่มพูด'}
          </Text>
          {activeEngine && !activeEngine.available && (
            <Text style={styles.warn}>⚠️ {activeEngine.unavailableReason}</Text>
          )}
        </View>

        {/* Live partial while listening */}
        {listening && !!partial && (
          <View style={styles.partialCard}>
            <Text style={styles.partialText}>{partial}</Text>
          </View>
        )}

        {/* Error */}
        {error && (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Transcript */}
        {last && (
          <View style={styles.resultCard}>
            <Text style={styles.resultLabel}>ได้ยินว่า</Text>
            <Text style={styles.resultText}>
              {last.text || '(ไม่มีข้อความ)'}
            </Text>
            <View style={styles.resultMetaRow}>
              <Text style={styles.resultMeta}>
                {last.engine === 'cloud' ? '☁️ Cloud' : '📱 On-device'} · {last.elapsedMs}ms
              </Text>
              {!!last.text && (
                <Pressable onPress={() => speak(last.text)} hitSlop={8}>
                  <Text style={styles.replay}>🔊 พูดซ้ำ</Text>
                </Pressable>
              )}
            </View>
          </View>
        )}

        {/* Brain thinking */}
        {thinking && (
          <View style={styles.thinkingRow}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.thinkingText}>กำลังคิด…</Text>
          </View>
        )}

        {/* Brain interpretation */}
        {brain && (
          <View style={styles.brainCard}>
            <View style={styles.brainHeader}>
              <Text style={styles.brainIntent}>{intentLabel(brain.intent)}</Text>
              <Pressable onPress={() => speak(brain.speak_back)} hitSlop={8}>
                <Text style={styles.replay}>🔊</Text>
              </Pressable>
            </View>
            <Text style={styles.brainTitle}>{brain.title}</Text>
            {describeBrain(brain).map((row) => (
              <View key={row.label} style={styles.brainRow}>
                <Text style={styles.brainRowLabel}>{row.label}</Text>
                <Text style={styles.brainRowValue}>{row.value}</Text>
              </View>
            ))}
            <Text style={styles.brainSpeak}>“{brain.speak_back}”</Text>
          </View>
        )}

        {/* Saved items */}
        {hasHydrated && items.length > 0 && (
          <View style={styles.listSection}>
            <Text style={styles.listHeader}>📋 บันทึกไว้ ({items.length})</Text>
            {items.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                onToggle={() => toggleDone(item.id)}
                onDelete={() => handleDelete(item)}
              />
            ))}
          </View>
        )}

        <Text style={styles.footer}>
          ลองพูด: “ตั้งเตือนกินยาพรุ่งนี้ 9 โมง” · “ตั้งปลุกทุกวัน 8 โมง ยกเว้นเสาร์อาทิตย์”
        </Text>
      </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function MicButton({
  listening,
  busy,
  onPress,
}: {
  listening: boolean;
  busy: boolean;
  onPress: () => void;
}) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!listening) {
      pulse.stopAnimation();
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.12,
          duration: 650,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 650,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [listening, pulse]);

  return (
    <Animated.View style={{ transform: [{ scale: pulse }] }}>
      <Pressable
        onPress={onPress}
        disabled={busy}
        style={[
          styles.mic,
          listening && styles.micListening,
          busy && styles.micBusy,
        ]}
      >
        {busy ? (
          <ActivityIndicator color={colors.onPrimary} size="large" />
        ) : (
          <Text style={styles.micIcon}>{listening ? '⏹' : '🎤'}</Text>
        )}
      </Pressable>
    </Animated.View>
  );
}

const TYPE_ICON: Record<Item['type'], string> = {
  reminder: '⏰',
  event: '📅',
  note: '📝',
};

function ItemRow({
  item,
  onToggle,
  onDelete,
}: {
  item: Item;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const when = formatDateTime(item.start_at, item.all_day);
  const end = formatDateTime(item.end_at, item.all_day);
  const rec = formatRecurrence(item.recurrence);
  const sub = [when && (end ? `${when} – ${end}` : when), rec].filter(Boolean).join(' · ');

  return (
    <View style={[styles.itemRow, item.done && styles.itemRowDone]}>
      <Pressable onPress={onToggle} hitSlop={8} style={styles.itemCheck}>
        <Text style={styles.itemCheckText}>{item.done ? '✅' : TYPE_ICON[item.type]}</Text>
      </Pressable>
      <View style={styles.itemBody}>
        <Text style={[styles.itemTitle, item.done && styles.itemTitleDone]} numberOfLines={1}>
          {item.title}
        </Text>
        {!!sub && <Text style={styles.itemSub} numberOfLines={1}>{sub}</Text>}
      </View>
      <Pressable onPress={onDelete} hitSlop={8}>
        <Text style={styles.itemDelete}>🗑</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { padding: spacing.xl, gap: spacing.xl, flexGrow: 1 },
  header: { alignItems: 'center', gap: spacing.xs, marginTop: spacing.md },
  title: { color: colors.text, fontSize: font.xl, fontWeight: '800' },
  subtitle: { color: colors.textMute, fontSize: font.sm },

  toggleRow: { flexDirection: 'row', gap: spacing.md },
  toggle: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  toggleSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  toggleDisabled: { opacity: 0.5 },
  toggleLabel: { color: colors.text, fontSize: font.md, fontWeight: '700' },
  toggleLabelSelected: { color: colors.primary },
  toggleHint: { color: colors.textFaint, fontSize: font.xs, lineHeight: 16 },

  micWrap: { alignItems: 'center', gap: spacing.md, marginVertical: spacing.lg },
  mic: {
    width: 148,
    height: 148,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOpacity: 0.5,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  micListening: { backgroundColor: colors.danger, shadowColor: colors.danger },
  micBusy: { backgroundColor: colors.primaryDark },
  micIcon: { fontSize: 56 },
  statusText: { color: colors.textMute, fontSize: font.md, fontWeight: '600' },
  warn: { color: colors.warning, fontSize: font.sm, textAlign: 'center' },

  partialCard: {
    backgroundColor: colors.bgAlt,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  partialText: { color: colors.textMute, fontSize: font.lg, fontStyle: 'italic' },

  errorCard: {
    backgroundColor: '#2A1416',
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  errorText: { color: colors.danger, fontSize: font.sm },

  resultCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  resultLabel: { color: colors.textFaint, fontSize: font.xs, fontWeight: '700', letterSpacing: 1 },
  resultText: { color: colors.text, fontSize: font.lg, lineHeight: 28 },
  resultMetaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  resultMeta: { color: colors.textFaint, fontSize: font.xs },
  replay: { color: colors.primary, fontSize: font.md, fontWeight: '700' },

  thinkingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, justifyContent: 'center' },
  thinkingText: { color: colors.textMute, fontSize: font.md },

  brainCard: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  brainHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brainIntent: { color: colors.primary, fontSize: font.sm, fontWeight: '800' },
  brainTitle: { color: colors.text, fontSize: font.xl, fontWeight: '800' },
  brainRow: { flexDirection: 'row', gap: spacing.sm },
  brainRowLabel: { color: colors.textFaint, fontSize: font.sm, width: 84 },
  brainRowValue: { color: colors.text, fontSize: font.sm, flex: 1, fontWeight: '600' },
  brainSpeak: {
    color: colors.textMute,
    fontSize: font.sm,
    fontStyle: 'italic',
    marginTop: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },

  listSection: { gap: spacing.sm },
  listHeader: { color: colors.textMute, fontSize: font.sm, fontWeight: '800', letterSpacing: 0.5 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  itemRowDone: { opacity: 0.55 },
  itemCheck: { width: 28, alignItems: 'center' },
  itemCheckText: { fontSize: 22 },
  itemBody: { flex: 1, gap: 2 },
  itemTitle: { color: colors.text, fontSize: font.md, fontWeight: '700' },
  itemTitleDone: { textDecorationLine: 'line-through', color: colors.textMute },
  itemSub: { color: colors.textFaint, fontSize: font.xs },
  itemDelete: { fontSize: font.lg },

  footer: { color: colors.textFaint, fontSize: font.sm, textAlign: 'center', marginTop: 'auto' },
});
