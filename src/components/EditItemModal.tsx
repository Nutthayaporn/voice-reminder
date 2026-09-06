import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Item } from '../store/types';
import { colors, font, radius, spacing } from '../theme';
import { DateTimeField } from './DateTimeField';

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
  const [dateTime, setDateTime] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!item) return;
    setTitle(item.title);
    setBody(item.body ?? '');
    setDateTime(item.start_at);
    setError(null);
  }, [item]);

  const save = () => {
    if (!item) return;
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError('Please enter a title.');
      return;
    }
    onSave({ title: cleanTitle, body: body.trim() || null, start_at: dateTime });
  };

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={!!item}>
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.modalSafeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.overlay}
        >
          <Pressable accessibilityLabel="Close editor" onPress={onClose} style={styles.dismiss} />
          <SafeAreaView edges={['bottom']} style={styles.sheet}>
            <ScrollView
              bounces={false}
              contentContainerStyle={styles.sheetContent}
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
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
                <DateTimeField
                  allDay={item?.all_day ?? false}
                  onChange={setDateTime}
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
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalSafeArea: { flex: 1, backgroundColor: 'rgba(0, 5, 9, 0.72)' },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 5, 9, 0.72)' },
  dismiss: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  sheet: { maxHeight: '100%', backgroundColor: colors.cardRaised, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderTopWidth: 1, borderColor: colors.borderBright, overflow: 'hidden' },
  sheetContent: { padding: spacing.xl, paddingBottom: spacing.md, gap: spacing.lg },
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
