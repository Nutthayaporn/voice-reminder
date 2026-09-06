import { useState } from 'react';
import { Pressable, Text, TextInput, View, StyleSheet } from 'react-native';
import { useSpaces } from '../spaces/useSpaces';
import { spaceLabel } from '../spaces/routing';
import { usePreferences } from '../store/usePreferences';
import { useStore } from '../store/useStore';
import { colors, spacing, radius } from '../theme';

export function SpacePicker({ disabled = false }: { disabled?: boolean }) {
  const [aliasText, setAliasText] = useState('');
  const [aliasSaved, setAliasSaved] = useState(false);
  const setAliases = usePreferences((s) => s.setSpaceAliases);
  const [open, setOpen] = useState(false);
  const selected = usePreferences((s) => s.activeHouseholdId);
  const select = usePreferences((s) => s.setActiveHouseholdId);
  const userId = useStore((s) => s.userId);
  const { spaces, ownerId, error, loading, refresh } = useSpaces();
  const available = ownerId === userId && userId ? spaces : [];
  // Personal is always available; show the picker only when there is another choice.
  if (available.length === 0) return null;

  return <View style={styles.box}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open, disabled }} disabled={disabled}
      onPress={() => { setOpen(!open); setAliasSaved(false); setAliasText(userId && selected ? (usePreferences.getState().spaceAliases[userId]?.[selected] ?? []).join(', ') : ''); if (!open) void refresh().catch(() => {}); }} style={styles.row}>
      <Text style={styles.text}>บันทึกและค้นใน: {spaceLabel(userId ? selected : null, available)} ▾</Text>
    </Pressable>
    {open && <View>
      {[{ id: null, name: 'Only me · ส่วนตัว' }, ...available].map((space) =>
        <Pressable key={space.id ?? 'personal'} accessibilityRole="radio" accessibilityState={{ selected: space.id === selected }} disabled={disabled}
          onPress={() => { select(space.id); setOpen(false); }} style={styles.row}>
          <Text style={styles.text}>{space.id === selected ? '✓ ' : ''}{space.name}{space.id ? ` · ${space.id.slice(0, 6)}` : ''}</Text>
        </Pressable>)}
      {userId && selected && available.some((s) => s.id === selected) && <View style={styles.row}>
        <Text style={styles.text}>ชื่อเรียกอื่นของ Space ที่เลือก (คั่นด้วย ,)</Text>
        <TextInput accessibilityLabel="Space aliases" value={aliasText} onChangeText={(text) => { setAliasText(text); setAliasSaved(false); }} placeholder="ชื่อเรียกที่คุณอยากใช้" placeholderTextColor={colors.textMute} style={[styles.row, styles.text]} />
        <Pressable accessibilityRole="button" disabled={disabled} onPress={() => { setAliases(userId, selected, aliasText.split(',')); setAliasSaved(true); void refresh().catch(() => {}); }} style={styles.row}>
          <Text style={styles.text}>{aliasSaved ? 'บันทึกชื่อเรียกแล้ว' : 'บันทึกชื่อเรียก'}</Text>
        </Pressable>
      </View>}
      {loading && <Text style={styles.hint}>กำลังโหลด Space…</Text>}
      {error && <Text style={styles.hint}>{error}</Text>}
      {!userId && <Text style={styles.hint}>เข้าสู่ระบบใน Settings เพื่อสร้างหรือเข้าร่วม Space</Text>}
    </View>}
  </View>;
}
const styles = StyleSheet.create({
  box: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  row: { padding: spacing.md, minHeight: 44 },
  text: { color: colors.text, fontSize: 14 },
  hint: { color: colors.textMute, padding: spacing.md },
});
