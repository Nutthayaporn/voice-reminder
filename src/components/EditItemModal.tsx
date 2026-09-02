import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { Item } from '../store/types';
import { colors, font, radius, spacing } from '../theme';

export interface ItemEditPatch {
  title: string;
  body: string | null;
  start_at: string | null;
}

export function EditItemModal({
  item,
  onClose,
  onSave,
}: {
  item: Item | null;
  onClose: () => void;
  onSave: (patch: ItemEditPatch) => void;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [dateTime, setDateTime] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!item) return;
    setTitle(item.title);
    setBody(item.body ?? '');
    setDateTime(formatEditableDate(item.start_at, item.all_day));
    setError(null);
  }, [item]);

  const save = () => {
    if (!item) return;
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError('Please enter a title.');
      return;
    }
    const parsed = parseBangkokDate(dateTime, item.all_day);
    if (parsed === undefined) {
      setError(item.all_day ? 'Use YYYY-MM-DD.' : 'Use YYYY-MM-DD HH:mm.');
      return;
    }
    onSave({ title: cleanTitle, body: body.trim() || null, start_at: parsed });
  };

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={!!item}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <Pressable accessibilityLabel="Close editor" onPress={onClose} style={styles.dismiss} />
        <View style={styles.sheet}>
          <View style={styles.heading}>
            <View>
              <Text style={styles.eyebrow}>EDIT ITEM</Text>
              <Text style={styles.title}>Edit item</Text>
            </View>
            <Pressable accessibilityLabel="Close" hitSlop={10} onPress={onClose}>
              <Text style={styles.close}>×</Text>
            </Pressable>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Title</Text>
            <TextInput
              autoFocus
              onChangeText={setTitle}
              placeholder="Item title"
              placeholderTextColor={colors.textFaint}
              style={styles.input}
              value={title}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Details</Text>
            <TextInput
              multiline
              onChangeText={setBody}
              placeholder="Optional details"
              placeholderTextColor={colors.textFaint}
              style={[styles.input, styles.multiline]}
              value={body}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>{item?.all_day ? 'Date' : 'Date and time'}</Text>
            <TextInput
              autoCapitalize="none"
              onChangeText={setDateTime}
              placeholder={item?.all_day ? '2026-09-01' : '2026-09-01 09:00'}
              placeholderTextColor={colors.textFaint}
              style={styles.input}
              value={dateTime}
            />
            <Text style={styles.hint}>Leave blank if this item does not need a date.</Text>
          </View>

          {error && <Text style={styles.error}>{error}</Text>}

          <View style={styles.actions}>
            <Pressable accessibilityRole="button" onPress={save} style={styles.saveButton}>
              <Text style={styles.saveText}>Save changes</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.cancelButton}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function formatEditableDate(value: string | null, allDay: boolean): string {
  if (!value) return '';
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (!match) return '';
  return allDay ? match[1] : `${match[1]} ${match[2]}`;
}

function parseBangkokDate(value: string, allDay: boolean): string | null | undefined {
  const clean = value.trim();
  if (!clean) return null;
  const pattern = allDay
    ? /^(\d{4})-(\d{2})-(\d{2})$/
    : /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/;
  const match = clean.match(pattern);
  if (!match) return undefined;
  const [, year, month, day, hour = '00', minute = '00'] = match;
  const candidate = new Date(`${year}-${month}-${day}T${hour}:${minute}:00+07:00`);
  if (Number.isNaN(candidate.getTime())) return undefined;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(candidate);
  const actual = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  if (`${actual.year}-${actual.month}-${actual.day}` !== `${year}-${month}-${day}`) {
    return undefined;
  }
  return `${year}-${month}-${day}T${hour}:${minute}:00+07:00`;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 5, 9, 0.72)' },
  dismiss: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  sheet: { backgroundColor: colors.cardRaised, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.xl, paddingBottom: spacing.xxl, gap: spacing.lg, borderTopWidth: 1, borderColor: colors.borderBright },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { color: colors.primary, fontSize: 9, fontWeight: '800', letterSpacing: 1.2 },
  title: { color: colors.text, fontSize: font.xl, fontWeight: '800', marginTop: 3 },
  close: { color: colors.textMute, fontSize: 32, lineHeight: 34 },
  field: { gap: spacing.sm },
  label: { color: colors.textMute, fontSize: font.xs, fontWeight: '700' },
  input: { color: colors.text, backgroundColor: colors.bgAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: font.md },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  hint: { color: colors.textFaint, fontSize: font.xs },
  error: { color: colors.danger, fontSize: font.xs },
  actions: { gap: spacing.sm },
  saveButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryDark, borderRadius: radius.md },
  saveText: { color: colors.onPrimary, fontSize: font.sm, fontWeight: '800' },
  cancelButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  cancelText: { color: colors.textMute, fontSize: font.sm, fontWeight: '700' },
});
