import { useState } from 'react';
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
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useStore } from '../store/useStore';
import { usePreferences } from '../store/usePreferences';
import { useSpaces } from '../spaces/useSpaces';
import { resolveSpace } from '../spaces/routing';
import { SpacePicker } from './SpacePicker';
import { actionToItem } from '../brain/toItem';
import { emptyAction } from '../brain/action';
import type { EntityKind } from '../store/details';
import { colors, font, radius, spacing } from '../theme';

const kinds: Array<{ id: EntityKind; label: string; icon: any }> = [
  { id: 'person', label: 'คน', icon: 'person-outline' },
  { id: 'pet', label: 'สัตว์เลี้ยง', icon: 'paw-outline' },
  { id: 'place', label: 'สถานที่', icon: 'location-outline' },
];

function kindMeta(kind?: EntityKind) {
  return kinds.find((k) => k.id === kind) ?? kinds[0];
}

const formExamples: Record<EntityKind, { label: string; name: string; description: string; aliases: string; hint: string }> = {
  person: { label: 'ชื่อคนที่ต้องการจำ', name: 'เช่น พลอย', description: 'เช่น ชอบชาเขียวหวานน้อย', aliases: 'เช่น แฟน, ที่รัก', hint: 'ถ้าชื่อคือ “พลอย” และคำเรียกคือ “แฟน” เวลาคุณพูดถึง “แฟน” VORA จะรู้ว่าหมายถึงพลอย' },
  pet: { label: 'ชื่อสัตว์เลี้ยง', name: 'เช่น โมจิ', description: 'เช่น แมวเพศผู้ ชอบอาหารรสปลา', aliases: 'เช่น แมว, เจ้าอ้วน', hint: 'ถ้าชื่อคือ “โมจิ” และคำเรียกคือ “แมว” เวลาคุณพูดถึง “แมว” VORA จะรู้ว่าหมายถึงโมจิ' },
  place: { label: 'ชื่อสถานที่ที่ต้องการจำ', name: 'เช่น บ้านยายเชียงใหม่', description: 'เช่น บ้านของยาย อยู่เชียงใหม่', aliases: 'เช่น บ้านยาย', hint: 'ถ้าชื่อคือ “บ้านยายเชียงใหม่” และคำเรียกคือ “บ้านยาย” คุณพูดสั้น ๆ ว่า “บ้านยาย” ได้' },
};

export function KnowledgePanel() {
  const items = useStore((s) => s.items);
  const userId = useStore((s) => s.userId);
  const selected = usePreferences((s) => s.activeHouseholdId);
  const allAliases = usePreferences((s) => s.entityAliases);
  const owner = userId ?? 'local';
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [aliases, setAliases] = useState('');
  const [kind, setKind] = useState<EntityKind>('person');
  const example = formExamples[kind];
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const scope = userId ? selected : null;
  const profiles = items.filter((item) => item.details?.profile && (item.household_id ?? null) === scope);

  const openCreate = () => {
    setEditing(null);
    setName('');
    setBody('');
    setAliases('');
    setKind('person');
    setMessage('');
    setOpen(true);
  };

  const openEdit = (id: string) => {
    const item = profiles.find((p) => p.id === id);
    if (!item) return;
    setEditing(id);
    setName(item.title);
    setBody(item.body ?? '');
    setKind(item.details!.profile!.kind);
    setAliases((allAliases[owner]?.[id] ?? []).join(', '));
    setMessage('');
    setOpen(true);
  };

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setMessage('');
    try {
      const spaces = userId ? await useSpaces.getState().refresh() : [];
      if (useStore.getState().userId !== userId || (userId ? usePreferences.getState().activeHouseholdId : null) !== scope) {
        throw new Error('พื้นที่เปลี่ยนแล้ว กรุณาลองใหม่');
      }
      resolveSpace({}, scope, spaces);
      let id = editing;
      if (id) {
        const original = profiles.find((item) => item.id === id);
        if (!original) throw new Error('ไม่พบข้อมูลในพื้นที่นี้');
        await useStore.getState().updateItem(id, {
          title: name.trim(),
          body: body.trim() || null,
          raw_text: body.trim() || name.trim(),
          details: { ...original.details, profile: { kind } },
        });
      } else {
        const item = actionToItem({ ...emptyAction('create_note', name.trim()), body: body.trim() || null }, body.trim() || name.trim(), 'notification', scope)!;
        item.details = { profile: { kind } };
        useStore.getState().addItem(item);
        id = item.id;
      }
      usePreferences.getState().setEntityAliases(owner, id, aliases.split(','));
      setEditing(null);
      setName('');
      setBody('');
      setAliases('');
      setOpen(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SpacePicker disabled={busy} />

      <View style={styles.card}>
        <View style={styles.headerRow}>
          <View style={styles.iconTile}>
            <Ionicons name="people-outline" size={18} color={colors.primary} />
          </View>
          <View style={styles.rowCopy}>
            <Text style={styles.rowLabel}>ผู้คน สัตว์เลี้ยง และสถานที่</Text>
            <Text style={styles.rowSub}>ชื่อและรายละเอียดใช้ร่วมกันตาม Space · ชื่อเรียกเป็นของคุณ</Text>
          </View>
        </View>

        {profiles.map((item) => {
          const meta = kindMeta(item.details?.profile?.kind);
          return (
            <View key={item.id}>
              <View style={styles.sep} />
              <Pressable
                accessibilityRole="button"
                onPress={() => openEdit(item.id)}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <View style={styles.iconTile}>
                  <Ionicons name={meta.icon} size={18} color={colors.primary} />
                </View>
                <View style={styles.rowCopy}>
                  <Text style={styles.rowLabel} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {meta.label}{item.body ? ` · ${item.body}` : ''}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
              </Pressable>
            </View>
          );
        })}

        <View style={styles.sep} />
        <Pressable
          accessibilityRole="button"
          onPress={openCreate}
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        >
          <View style={styles.iconTile}>
            <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
          </View>
          <Text style={[styles.rowLabel, { flex: 1 }]}>เพิ่มข้อมูล</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
        </Pressable>
      </View>

      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(false)}
      >
        <SafeAreaView style={styles.page} edges={['top', 'bottom']}>
          <View style={styles.pageHeader}>
            <Pressable accessibilityLabel="Close" hitSlop={10} onPress={() => setOpen(false)} style={styles.pageBack}>
              <Ionicons name="chevron-down" size={26} color={colors.textMute} />
            </Pressable>
            <Text style={styles.pageTitle}>{editing ? 'แก้ไขข้อมูล' : 'เพิ่มข้อมูล'}</Text>
            <View style={styles.pageBack} />
          </View>

          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
            <ScrollView contentContainerStyle={styles.pageBody} keyboardShouldPersistTaps="handled">
              <View style={styles.segment}>
                {kinds.map((k) => {
                  const active = kind === k.id;
                  return (
                    <Pressable
                      key={k.id}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active }}
                      onPress={() => setKind(k.id)}
                      style={[styles.segmentChip, active && styles.segmentChipActive]}
                    >
                      <Ionicons name={k.icon} size={16} color={active ? colors.primaryBright : colors.textMute} />
                      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{k.label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>{example.label} (จำเป็น)</Text>
                <TextInput
                  accessibilityLabel={example.label}
                  autoFocus
                  placeholder={example.name}
                  placeholderTextColor={colors.textFaint}
                  value={name}
                  onChangeText={setName}
                  style={styles.input}
                />
                <Text style={styles.hint}>ชื่อนี้จะแสดงในรายการข้อมูลที่บันทึกไว้</Text>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>ข้อมูลเพิ่มเติมที่อยากให้จำ (ไม่จำเป็น)</Text>
                <TextInput
                  accessibilityLabel="Entity description"
                  placeholder={example.description}
                  placeholderTextColor={colors.textFaint}
                  value={body}
                  onChangeText={setBody}
                  multiline
                  style={[styles.input, styles.multiline]}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>คำอื่นที่คุณใช้เรียก (ไม่จำเป็น)</Text>
                <TextInput
                  accessibilityLabel="คำอื่นที่คุณใช้เรียก"
                  placeholder={example.aliases}
                  placeholderTextColor={colors.textFaint}
                  value={aliases}
                  onChangeText={setAliases}
                  style={styles.input}
                />
                <Text style={styles.hint}>{example.hint}</Text>
                <Text style={styles.hint}>ถ้าเรียกด้วยชื่อด้านบนอยู่แล้ว เว้นว่างได้ · หลายคำให้คั่นด้วย ,</Text>
                <Text style={styles.hint}>คำเรียกนี้ใช้เฉพาะคุณบนเครื่องนี้ สมาชิกคนอื่นตั้งคำเรียกของตัวเองได้</Text>
              </View>

              {!!message && <Text style={styles.pageError}>{message}</Text>}

              <Pressable
                accessibilityRole="button"
                disabled={busy || !name.trim()}
                onPress={() => void save()}
                style={({ pressed }) => [styles.primaryBtn, (busy || !name.trim()) && styles.disabled, pressed && styles.pressed]}
              >
                <Text style={styles.primaryBtnText}>{busy ? 'กำลังบันทึก…' : 'บันทึก'}</Text>
              </Pressable>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 60,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  rowPressed: { backgroundColor: colors.cardRaised },
  rowCopy: { flex: 1, minWidth: 0, gap: 2 },
  rowLabel: { color: colors.text, fontSize: font.md, fontWeight: '600' },
  rowSub: { color: colors.textMute, fontSize: font.xs, lineHeight: 16 },
  sep: { height: 1, backgroundColor: colors.border, marginLeft: 64 },
  iconTile: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },

  // Presented add/edit page (modal).
  flex: { flex: 1 },
  page: { flex: 1, backgroundColor: colors.bg },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pageBack: { width: 40, alignItems: 'center' },
  pageTitle: { color: colors.text, fontSize: font.lg, fontWeight: '800' },
  pageBody: { padding: spacing.lg, gap: spacing.lg },

  segment: {
    flexDirection: 'row',
    gap: spacing.xs,
    backgroundColor: colors.cardRaised,
    borderRadius: radius.md,
    padding: spacing.xs,
  },
  segmentChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  segmentChipActive: { backgroundColor: colors.primarySoft, borderColor: colors.primaryDark },
  segmentText: { color: colors.textMute, fontSize: font.sm, fontWeight: '700' },
  segmentTextActive: { color: colors.primaryBright },

  field: { gap: spacing.sm },
  label: { color: colors.textMute, fontSize: font.xs, fontWeight: '700' },
  input: {
    color: colors.text,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    fontSize: font.md,
  },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  hint: { color: colors.textMute, fontSize: font.xs, lineHeight: 18 },
  pageError: { color: colors.danger, fontSize: font.sm, lineHeight: 20 },

  primaryBtn: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primaryDark,
    marginTop: spacing.sm,
  },
  primaryBtnText: { color: colors.onPrimary, fontSize: font.md, fontWeight: '800' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.7 },
});
