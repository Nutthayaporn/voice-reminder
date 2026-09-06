import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { usePreferences } from '../store/usePreferences';
import { useStore } from '../store/useStore';
import { changeDefaults, initialDefaults } from '../domain/defaults';
import { colors, font, radius, spacing } from '../theme';

const LANGUAGES = [
  { id: 'auto', label: 'ตามที่พูด' },
  { id: 'th', label: 'ไทย' },
  { id: 'en', label: 'English' },
] as const;

export function PersonalDefaultsPanel() {
  const owner = useStore((s) => s.userId) ?? 'local';
  const prefs = usePreferences((s) => s.personalDefaults[owner]) ?? initialDefaults;
  const save = usePreferences((s) => s.setPersonalDefaults);
  const [phrase, setPhrase] = useState('');
  const [time, setTime] = useState('');
  const [lead, setLead] = useState('');
  const [error, setError] = useState('');

  const update = (key: string, value: string | null) => {
    try {
      save(owner, changeDefaults(prefs, key, value));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const phrases = Object.entries(prefs.timePhrases);

  return (
    <View style={styles.card}>
      {/* Response language */}
      <View style={styles.headerRow}>
        <View style={styles.iconTile}>
          <Ionicons name="chatbubbles-outline" size={18} color={colors.primary} />
        </View>
        <View style={styles.rowCopy}>
          <Text style={styles.rowLabel}>ภาษาที่ตอบกลับ</Text>
          <Text style={styles.rowSub}>ภาษาที่ผู้ช่วยใช้พูดตอบ</Text>
        </View>
      </View>
      <View style={styles.segment}>
        {LANGUAGES.map((language) => {
          const selected = prefs.responseLanguage === language.id;
          return (
            <Pressable
              key={language.id}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => update('response_language', language.id)}
              style={[styles.segmentChip, selected && styles.segmentChipActive]}
            >
              <Text style={[styles.segmentText, selected && styles.segmentTextActive]}>{language.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.sep} />

      {/* Reminder lead time */}
      <View style={styles.headerRow}>
        <View style={styles.iconTile}>
          <Ionicons name="alarm-outline" size={18} color={colors.primary} />
        </View>
        <View style={styles.rowCopy}>
          <Text style={styles.rowLabel}>เตือนล่วงหน้า</Text>
          <Text style={styles.rowSub}>ก่อนถึงเวลานัดหมาย</Text>
        </View>
        <Text style={styles.rowValue}>
          {prefs.leadMinutes === null ? 'ปิด' : `${prefs.leadMinutes} นาที`}
        </Text>
      </View>
      <View style={styles.inlineForm}>
        <TextInput
          accessibilityLabel="Reminder lead minutes"
          value={lead}
          onChangeText={setLead}
          keyboardType="number-pad"
          placeholder="จำนวนนาที"
          placeholderTextColor={colors.textFaint}
          style={styles.input}
        />
        <Pressable
          accessibilityRole="button"
          disabled={!lead.trim()}
          onPress={() => { update('reminder_lead_minutes', lead); setLead(''); }}
          style={({ pressed }) => [styles.primaryBtn, !lead.trim() && styles.disabled, pressed && styles.pressed]}
        >
          <Text style={styles.primaryBtnText}>ตั้ง</Text>
        </Pressable>
        {prefs.leadMinutes !== null && (
          <Pressable
            accessibilityRole="button"
            onPress={() => update('reminder_lead_minutes', null)}
            style={({ pressed }) => [styles.ghostBtn, pressed && styles.pressed]}
          >
            <Text style={styles.ghostBtnText}>ล้าง</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.sep} />

      {/* Custom time phrases */}
      <View style={styles.headerRow}>
        <View style={styles.iconTile}>
          <Ionicons name="time-outline" size={18} color={colors.primary} />
        </View>
        <View style={styles.rowCopy}>
          <Text style={styles.rowLabel}>คำเรียกเวลาของคุณ</Text>
          <Text style={styles.rowSub}>เช่น “ตอนเช้า” = 08:00</Text>
        </View>
      </View>
      {phrases.length > 0 && (
        <View style={styles.chips}>
          {phrases.map(([key, value]) => (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={`Remove time phrase ${key}`}
              onPress={() => update(key, null)}
              style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
            >
              <Text style={styles.chipText}>{key} · {value}</Text>
              <Ionicons name="close" size={14} color={colors.textMute} />
            </Pressable>
          ))}
        </View>
      )}
      <View style={styles.inlineForm}>
        <TextInput
          accessibilityLabel="Time phrase"
          value={phrase}
          onChangeText={setPhrase}
          placeholder="เช่น ตอนเช้า"
          placeholderTextColor={colors.textFaint}
          style={[styles.input, styles.inputGrow]}
        />
        <TextInput
          accessibilityLabel="Phrase time HH:mm"
          value={time}
          onChangeText={setTime}
          placeholder="08:00"
          placeholderTextColor={colors.textFaint}
          style={[styles.input, styles.inputTime]}
        />
        <Pressable
          accessibilityRole="button"
          disabled={!phrase.trim() || !time.trim()}
          onPress={() => { update(phrase, time); setPhrase(''); setTime(''); }}
          style={({ pressed }) => [styles.primaryBtn, (!phrase.trim() || !time.trim()) && styles.disabled, pressed && styles.pressed]}
        >
          <Ionicons name="add" size={20} color={colors.onPrimary} />
        </Pressable>
      </View>

      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    overflow: 'hidden',
    paddingBottom: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  rowCopy: { flex: 1, minWidth: 0, gap: 2 },
  rowLabel: { color: colors.text, fontSize: font.md, fontWeight: '600' },
  rowSub: { color: colors.textMute, fontSize: font.xs, lineHeight: 16 },
  rowValue: { color: colors.primaryBright, fontSize: font.sm, fontWeight: '700' },
  sep: { height: 1, backgroundColor: colors.border, marginLeft: 64, marginTop: spacing.md },
  iconTile: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },

  segment: {
    flexDirection: 'row',
    gap: spacing.xs,
    backgroundColor: colors.cardRaised,
    borderRadius: radius.md,
    padding: spacing.xs,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  segmentChip: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  segmentChipActive: { backgroundColor: colors.primarySoft, borderColor: colors.primaryDark },
  segmentText: { color: colors.textMute, fontSize: font.sm, fontWeight: '700' },
  segmentTextActive: { color: colors.primaryBright },

  inlineForm: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  input: {
    flex: 1,
    color: colors.text,
    backgroundColor: colors.bgAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    fontSize: font.md,
  },
  inputGrow: { flex: 2 },
  inputTime: { flex: 1, textAlign: 'center' },
  primaryBtn: {
    minWidth: 48,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primaryDark,
  },
  primaryBtnText: { color: colors.onPrimary, fontSize: font.sm, fontWeight: '800' },
  ghostBtn: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ghostBtnText: { color: colors.textMute, fontSize: font.sm, fontWeight: '700' },

  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.cardRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipText: { color: colors.text, fontSize: font.xs, fontWeight: '600' },

  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.7 },
  error: { color: colors.danger, fontSize: font.xs, lineHeight: 18, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
});
