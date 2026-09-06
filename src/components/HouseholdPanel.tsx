import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
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

import { colors, font, radius, spacing } from '../theme';
import { usePreferences } from '../store/usePreferences';
import { useStore } from '../store/useStore';
import {
  createHousehold,
  joinHousehold,
  listHouseholds,
  previewHouseholdInvite,
  type Household,
} from '../store/households';
import { shareHouseholdInvite } from '../sharing/householdInvite';

type PanelMode = 'idle' | 'create' | 'join' | 'invite';

export function HouseholdPanel({
  pendingInviteCode = null,
  onClearPendingInvite,
}: {
  pendingInviteCode?: string | null;
  onClearPendingInvite?: () => void;
}) {
  const signedIn = useStore((state) => state.syncMode === 'cloud' && !!state.userId);
  const syncNow = useStore((state) => state.syncNow);
  const activeHouseholdId = usePreferences((state) => state.activeHouseholdId);
  const setActiveHouseholdId = usePreferences((state) => state.setActiveHouseholdId);
  const [households, setHouseholds] = useState<Household[]>([]);
  const [mode, setMode] = useState<PanelMode>('idle');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteName, setInviteName] = useState<string | null>(null);
  const [alreadyMember, setAlreadyMember] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [shareMessage, setShareMessage] = useState<string | null>(null);

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

  useEffect(() => {
    setPreviewBusy(false);
    if (!pendingInviteCode) {
      setMode((current) => (current === 'invite' ? 'idle' : current));
      return;
    }

    setValue(pendingInviteCode);
    setMode('invite');
    setError(null);
    setInviteName(null);
    setAlreadyMember(false);

    if (!signedIn) return;

    const knownHousehold = households.find(
      (household) => household.invite_code === pendingInviteCode,
    );
    if (knownHousehold) {
      setInviteName(knownHousehold.name);
      setAlreadyMember(true);
      return;
    }

    let active = true;
    setPreviewBusy(true);
    void previewHouseholdInvite(pendingInviteCode)
      .then((preview) => {
        if (!active) return;
        setInviteName(preview.name);
        setAlreadyMember(preview.already_member);
      })
      // Joining still works when an older deployment has not applied the
      // optional preview RPC yet, so keep the confirmation screen generic.
      .catch(() => undefined)
      .finally(() => {
        if (active) setPreviewBusy(false);
      });

    return () => {
      active = false;
    };
  }, [households, pendingInviteCode, signedIn]);

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
      if (mode === 'invite') onClearPendingInvite?.();
      await refresh();
      await syncNow();
    } catch (caught) {
      setError(formatHouseholdError(caught));
    } finally {
      setBusy(false);
    }
  };

  const shareInvite = async (household: Household) => {
    setError(null);
    setShareMessage(null);
    try {
      const result = await shareHouseholdInvite({
        name: household.name,
        inviteCode: household.invite_code,
      });
      setShareMessage(result === 'copied' ? 'Invite copied to clipboard.' : 'Invite ready to share.');
    } catch (caught) {
      setError(formatHouseholdError(caught));
    }
  };

  // Signed out — a single calm row, no forms.
  if (!signedIn) {
    return (
      <View style={styles.card}>
        <View style={styles.row}>
          <IconTile name="people-outline" muted />
          <View style={styles.rowCopy}>
            <Text style={styles.rowLabel}>
              {pendingInviteCode ? 'Invitation waiting' : 'Shared spaces'}
            </Text>
            <Text style={styles.rowSub}>
              {pendingInviteCode
                ? 'Sign in above to view and join this shared space'
                : 'Sign in to create or join a shared space'}
            </Text>
          </View>
          {pendingInviteCode && (
            <Pressable
              accessibilityLabel="Dismiss invitation"
              hitSlop={8}
              onPress={onClearPendingInvite}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <Ionicons name="close" size={20} color={colors.textMute} />
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  const openForm = (next: 'create' | 'join') => {
    setValue('');
    setError(null);
    setMode(next);
  };

  const closeForm = () => {
    if (mode === 'invite') onClearPendingInvite?.();
    setMode('idle');
    setValue('');
    setError(null);
  };

  return (
    <>
      <View style={styles.card}>
        <SpaceRow
          icon="lock-closed-outline"
          label="Only me"
          sub="Keep new items private"
          selected={activeHouseholdId === null}
          onPress={() => setActiveHouseholdId(null)}
        />

        {households.map((household) => (
          <View key={household.id}>
            <View style={styles.sep} />
            <SpaceRow
              icon="home-outline"
              label={household.name}
              sub={`Code ${household.invite_code} · ${household.role === 'owner' ? 'Owner' : 'Member'}`}
              selected={household.id === activeHouseholdId}
              onPress={() => setActiveHouseholdId(household.id)}
              onShare={() => void shareInvite(household)}
            />
          </View>
        ))}

        <View style={styles.sep} />
        <ActionRow icon="add-circle-outline" label="Create a space" onPress={() => openForm('create')} />
        <View style={styles.sep} />
        <ActionRow icon="enter-outline" label="Join with a code" onPress={() => openForm('join')} />

        {mode === 'idle' && error ? <Text style={styles.error}>{error}</Text> : null}
        {mode === 'idle' && shareMessage ? <Text style={styles.success}>{shareMessage}</Text> : null}
      </View>

      <Modal
        visible={mode !== 'idle'}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeForm}
      >
        <SafeAreaView style={styles.page} edges={['top', 'bottom']}>
          <View style={styles.pageHeader}>
            <Pressable accessibilityLabel="Close" hitSlop={10} onPress={closeForm} style={styles.pageBack}>
              <Ionicons name="chevron-down" size={26} color={colors.textMute} />
            </Pressable>
            <Text style={styles.pageTitle}>
              {mode === 'create' ? 'Create a space' : 'Join a space'}
            </Text>
            <View style={styles.pageBack} />
          </View>

          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.flex}
          >
            <ScrollView contentContainerStyle={styles.pageBody} keyboardShouldPersistTaps="handled">
              <View style={styles.heroIcon}>
                <Ionicons
                  name={mode === 'create' ? 'people' : mode === 'invite' ? 'link' : 'enter'}
                  size={30}
                  color={colors.primary}
                />
              </View>
              <Text style={styles.pageLead}>
                {mode === 'create'
                  ? 'Create a shared space so everyone can view and edit the same items.'
                  : mode === 'invite'
                    ? inviteName
                      ? `You've been invited to join “${inviteName}”. Everyone in this space can view and edit its items.`
                      : 'You’ve been invited to a shared space. Confirm below to join it.'
                    : 'Enter the invite code a member shared with you to join their space.'}
              </Text>

              {mode === 'invite' ? (
                <View style={styles.invitePreview}>
                  <View style={styles.invitePreviewIcon}>
                    {previewBusy ? (
                      <ActivityIndicator color={colors.primary} size="small" />
                    ) : (
                      <Ionicons name="home" size={21} color={colors.primary} />
                    )}
                  </View>
                  <View style={styles.rowCopy}>
                    <Text style={styles.invitePreviewName}>{inviteName ?? 'Shared space'}</Text>
                    <Text style={styles.invitePreviewCode}>
                      Code {value}{alreadyMember ? ' · Already joined' : ''}
                    </Text>
                  </View>
                </View>
              ) : (
                <TextInput
                  accessibilityLabel={mode === 'create' ? 'Shared space name' : 'Invite code'}
                  autoCapitalize={mode === 'join' ? 'characters' : 'sentences'}
                  autoFocus
                  editable={!busy}
                  onChangeText={setValue}
                  onSubmitEditing={() => void submit()}
                  placeholder={mode === 'create' ? 'e.g. Our Home' : 'Eight-character code'}
                  placeholderTextColor={colors.textFaint}
                  returnKeyType="done"
                  style={styles.pageInput}
                  value={value}
                />
              )}

              {error ? <Text style={styles.pageError}>{error}</Text> : null}

              <Pressable
                accessibilityRole="button"
                disabled={busy || !value.trim()}
                onPress={() => void submit()}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  (busy || !value.trim()) && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                {busy ? (
                  <ActivityIndicator color={colors.onPrimary} size="small" />
                ) : (
                  <Text style={styles.primaryBtnText}>{mode === 'create' ? 'Create space' : 'Join space'}</Text>
                )}
              </Pressable>

              {mode === 'invite' && (
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={closeForm}
                  style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
                >
                  <Text style={styles.secondaryBtnText}>Not now</Text>
                </Pressable>
              )}
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

function IconTile({ name, muted }: { name: any; muted?: boolean }) {
  return (
    <View style={[styles.iconTile, muted && styles.iconTileMuted]}>
      <Ionicons name={name} size={18} color={muted ? colors.textMute : colors.primary} />
    </View>
  );
}

function SpaceRow({
  icon,
  label,
  sub,
  selected,
  onPress,
  onShare,
}: {
  icon: any;
  label: string;
  sub: string;
  selected: boolean;
  onPress: () => void;
  onShare?: () => void;
}) {
  return (
    <View style={styles.spaceRowShell}>
      <Pressable
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        onPress={onPress}
        style={({ pressed }) => [styles.row, styles.spaceRowMain, pressed && styles.rowPressed]}
      >
        <IconTile name={icon} />
        <View style={styles.rowCopy}>
          <Text style={[styles.rowLabel, selected && styles.rowLabelActive]} numberOfLines={1}>{label}</Text>
          <Text style={styles.rowSub} numberOfLines={1}>{sub}</Text>
        </View>
        {selected && <Ionicons name="checkmark-circle" size={22} color={colors.primary} />}
      </Pressable>
      {onShare && (
        <Pressable
          accessibilityLabel={`Share invite to ${label}`}
          accessibilityRole="button"
          hitSlop={4}
          onPress={onShare}
          style={({ pressed }) => [styles.shareBtn, pressed && styles.rowPressed]}
        >
          <Ionicons name="share-outline" size={21} color={colors.primary} />
        </Pressable>
      )}
    </View>
  );
}

function ActionRow({ icon, label, onPress }: { icon: any; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <IconTile name={icon} />
      <Text style={[styles.rowLabel, { flex: 1 }]}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
    </Pressable>
  );
}

function formatHouseholdError(caught: unknown): string {
  if (caught && typeof caught === 'object' && 'code' in caught && caught.code === 'PGRST202') {
    return 'Shared spaces are not enabled in Supabase. Apply the latest migration first.';
  }
  return caught instanceof Error ? caught.message : String(caught);
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    overflow: 'hidden',
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
  spaceRowShell: { flexDirection: 'row', alignItems: 'stretch' },
  spaceRowMain: { flex: 1, paddingRight: spacing.sm },
  shareBtn: {
    width: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
  },
  rowCopy: { flex: 1, minWidth: 0, gap: 2 },
  rowLabel: { color: colors.text, fontSize: font.md, fontWeight: '600' },
  rowLabelActive: { color: colors.primaryBright },
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
  iconTileMuted: { backgroundColor: 'rgba(139, 169, 181, 0.12)' },

  // Presented create/join page (modal).
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
  pageBody: { padding: spacing.lg, gap: spacing.md },
  heroIcon: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.borderBright,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  pageLead: {
    color: colors.textMute,
    fontSize: font.sm,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  pageInput: {
    color: colors.text,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    fontSize: font.md,
  },
  invitePreview: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderBright,
    borderRadius: radius.md,
    backgroundColor: colors.card,
  },
  invitePreviewIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  invitePreviewName: { color: colors.text, fontSize: font.md, fontWeight: '700' },
  invitePreviewCode: { color: colors.textMute, fontSize: font.xs },
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
  secondaryBtn: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  secondaryBtnText: { color: colors.textMute, fontSize: font.sm, fontWeight: '700' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.72 },
  error: {
    color: colors.danger,
    fontSize: font.xs,
    lineHeight: 18,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  success: {
    color: colors.success,
    fontSize: font.xs,
    lineHeight: 18,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
});
