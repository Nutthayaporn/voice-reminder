import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, font, radius, spacing } from '../theme';
import { usePreferences } from '../store/usePreferences';
import { useStore } from '../store/useStore';
import {
  createHousehold,
  joinHousehold,
  listHouseholds,
  type Household,
} from '../store/households';

export function HouseholdPanel() {
  const signedIn = useStore((state) => state.syncMode === 'cloud' && !!state.userId);
  const syncNow = useStore((state) => state.syncNow);
  const activeHouseholdId = usePreferences((state) => state.activeHouseholdId);
  const setActiveHouseholdId = usePreferences((state) => state.setActiveHouseholdId);
  const [households, setHouseholds] = useState<Household[]>([]);
  const [mode, setMode] = useState<'idle' | 'create' | 'join'>('idle');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!signedIn) {
      setHouseholds([]);
      setActiveHouseholdId(null);
      return;
    }
    try {
      const rows = await listHouseholds();
      setHouseholds(rows);
      if (activeHouseholdId && !rows.some((row) => row.id === activeHouseholdId)) {
        setActiveHouseholdId(null);
      }
    } catch (caught) {
      setError(formatHouseholdError(caught));
    }
  }, [activeHouseholdId, setActiveHouseholdId, signedIn]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submit = async () => {
    if (!value.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const household =
        mode === 'create' ? await createHousehold(value) : await joinHousehold(value);
      setActiveHouseholdId(household.id);
      setValue('');
      setMode('idle');
      await refresh();
      await syncNow();
    } catch (caught) {
      setError(formatHouseholdError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.panel}>
      <View style={styles.heading}>
        <View>
          <Text style={styles.eyebrow}>SHARED SPACE</Text>
          <Text style={styles.title}>Shared space</Text>
        </View>
        {busy && <ActivityIndicator color={colors.primary} size="small" />}
      </View>
      <Text style={styles.description}>
        Choose where new items are saved. Every member can view and edit shared items.
      </Text>

      {!signedIn ? (
        <Text style={styles.notice}>Sign in above to create or join a shared space.</Text>
      ) : (
        <>
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected: activeHouseholdId === null }}
            onPress={() => setActiveHouseholdId(null)}
            style={[styles.spaceRow, activeHouseholdId === null && styles.spaceRowSelected]}
          >
            <View style={styles.spaceCopy}>
              <Text style={styles.spaceName}>Only me</Text>
              <Text style={styles.spaceMeta}>Keep new items private</Text>
            </View>
            <Text style={styles.check}>{activeHouseholdId === null ? '✓' : ''}</Text>
          </Pressable>

          {households.map((household) => {
            const selected = household.id === activeHouseholdId;
            return (
              <Pressable
                key={household.id}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => setActiveHouseholdId(household.id)}
                style={[styles.spaceRow, selected && styles.spaceRowSelected]}
              >
                <View style={styles.spaceCopy}>
                  <Text style={styles.spaceName}>{household.name}</Text>
                  <Text style={styles.spaceMeta}>
                    Invite code {household.invite_code} · {household.role === 'owner' ? 'Owner' : 'Member'}
                  </Text>
                </View>
                <Text style={styles.check}>{selected ? '✓' : ''}</Text>
              </Pressable>
            );
          })}

          {mode === 'idle' ? (
            <View style={styles.actions}>
              <SmallButton label="CREATE SPACE" onPress={() => setMode('create')} />
              <SmallButton label="JOIN WITH CODE" subtle onPress={() => setMode('join')} />
            </View>
          ) : (
            <View style={styles.form}>
              <TextInput
                accessibilityLabel={mode === 'create' ? 'Shared space name' : 'Invite code'}
                autoCapitalize={mode === 'join' ? 'characters' : 'sentences'}
                editable={!busy}
                onChangeText={setValue}
                onSubmitEditing={() => void submit()}
                placeholder={mode === 'create' ? 'e.g. Our Home' : 'Eight-character code'}
                placeholderTextColor={colors.textFaint}
                returnKeyType="done"
                style={styles.input}
                value={value}
              />
              <View style={styles.actions}>
                <SmallButton label={mode === 'create' ? 'CREATE' : 'JOIN'} onPress={() => void submit()} />
                <SmallButton label="CANCEL" subtle onPress={() => { setMode('idle'); setValue(''); }} />
              </View>
            </View>
          )}
        </>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

function formatHouseholdError(caught: unknown): string {
  if (caught && typeof caught === 'object' && 'code' in caught && caught.code === 'PGRST202') {
    return 'Shared spaces are not enabled in Supabase. Apply the latest migration first.';
  }
  return caught instanceof Error ? caught.message : String(caught);
}

function SmallButton({ label, onPress, subtle = false }: { label: string; onPress: () => void; subtle?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.button, subtle && styles.buttonSubtle, pressed && styles.pressed]}
    >
      <Text style={[styles.buttonText, subtle && styles.buttonTextSubtle]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { color: colors.primary, fontSize: 9, fontWeight: '800', letterSpacing: 1.2 },
  title: { color: colors.text, fontSize: font.lg, fontWeight: '800', marginTop: 3 },
  description: { color: colors.textMute, fontSize: font.sm, lineHeight: 20 },
  notice: { color: colors.warning, fontSize: font.sm, lineHeight: 20 },
  spaceRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md },
  spaceRowSelected: { borderColor: colors.primaryDark, backgroundColor: colors.primarySoft },
  spaceCopy: { flex: 1, minWidth: 0, gap: 3 },
  spaceName: { color: colors.text, fontSize: font.sm, fontWeight: '700' },
  spaceMeta: { color: colors.textFaint, fontSize: font.xs },
  check: { color: colors.primary, fontSize: font.md, width: 20, textAlign: 'right' },
  actions: { flexDirection: 'row', gap: spacing.sm },
  form: { gap: spacing.sm },
  input: { color: colors.text, backgroundColor: colors.bgAlt, borderWidth: 1, borderColor: colors.borderBright, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 11, fontSize: font.sm },
  button: { minHeight: 40, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg, borderRadius: radius.md, backgroundColor: colors.primaryDark },
  buttonSubtle: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
  buttonText: { color: colors.onPrimary, fontSize: font.xs, fontWeight: '800' },
  buttonTextSubtle: { color: colors.textMute },
  pressed: { opacity: 0.72 },
  error: { color: colors.danger, fontSize: font.xs, lineHeight: 18 },
});
