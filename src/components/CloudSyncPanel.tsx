import { useEffect, useState } from 'react';
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
import { isSupabaseConfigured, useStore } from '../store/useStore';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formatSyncTime(value: string | null): string {
  if (!value) return 'Not synced yet';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function CloudSyncPanel({ autoOpen = false }: { autoOpen?: boolean }) {
  const configured = isSupabaseConfigured();
  const syncMode = useStore((state) => state.syncMode);
  const userId = useStore((state) => state.userId);
  const userEmail = useStore((state) => state.userEmail);
  const syncing = useStore((state) => state.syncing);
  const syncError = useStore((state) => state.syncError);
  const lastSyncedAt = useStore((state) => state.lastSyncedAt);
  const pendingCount = useStore((state) =>
    state.pendingOps.filter((op) => op.userId === state.userId).length,
  );
  const signInWithPassword = useStore((state) => state.signInWithPassword);
  const signUpWithPassword = useStore((state) => state.signUpWithPassword);
  const signInWithProvider = useStore((state) => state.signInWithProvider);
  const signOut = useStore((state) => state.signOut);
  const syncNow = useStore((state) => state.syncNow);
  const clearSyncError = useStore((state) => state.clearSyncError);

  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (autoOpen && configured && !(syncMode === 'cloud' && userId)) {
      setExpanded(true);
    }
  }, [autoOpen, configured, syncMode, userId]);

  const submitEmail = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(cleanEmail)) {
      setMessage('Enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      setMessage('Password must be at least six characters.');
      return;
    }

    setBusy(true);
    setMessage(null);
    clearSyncError();
    const result = await (mode === 'signIn'
      ? signInWithPassword(cleanEmail, password)
      : signUpWithPassword(cleanEmail, password)
    ).catch((error: unknown) => ({
      error: error instanceof Error ? error.message : String(error),
    }));
    setBusy(false);
    if (result.error) {
      setMessage(result.error);
      return;
    }
    setEmail(cleanEmail);
    setPassword('');
    if ('needsEmailConfirmation' in result && result.needsEmailConfirmation) {
      setMessage('Account created. Check your email to confirm it, then sign in.');
      setMode('signIn');
      return;
    }
    setExpanded(false);
  };

  const submitProvider = async (provider: 'google' | 'facebook') => {
    setBusy(true);
    setMessage(null);
    clearSyncError();
    const result = await signInWithProvider(provider).catch((error: unknown) => ({
      error: error instanceof Error ? error.message : String(error),
    }));
    setBusy(false);
    if (result.error) {
      setMessage(result.error);
      return;
    }
    if (!('cancelled' in result) || !result.cancelled) setExpanded(false);
  };

  const closeForm = () => {
    setExpanded(false);
    setPassword('');
    setMessage(null);
  };

  // Cloud sync not configured — one calm, muted line.
  if (!configured) {
    return (
      <View style={styles.card}>
        <View style={styles.row}>
          <IconTile name="cloud-offline-outline" muted />
          <View style={styles.rowCopy}>
            <Text style={styles.rowLabel}>On this device</Text>
            <Text style={styles.rowSub}>Cloud sync isn't set up. Your items stay offline.</Text>
          </View>
        </View>
      </View>
    );
  }

  // Signed in — clean profile card with sync + sign-out actions.
  if (syncMode === 'cloud' && userId) {
    const status = syncing
      ? 'Syncing…'
      : pendingCount
        ? `${pendingCount} change${pendingCount > 1 ? 's' : ''} pending`
        : `Synced · ${formatSyncTime(lastSyncedAt)}`;
    return (
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.avatar}>
            <Ionicons name="person" size={20} color={colors.primary} />
          </View>
          <View style={styles.rowCopy}>
            <Text style={styles.rowLabel} numberOfLines={1}>
              {userEmail || 'Signed-in account'}
            </Text>
            <View style={styles.statusLine}>
              <View style={[styles.dot, !syncing && !pendingCount && styles.dotOk]} />
              <Text style={styles.rowSub} numberOfLines={1}>{status}</Text>
            </View>
          </View>
          {syncing && <ActivityIndicator color={colors.primary} size="small" />}
        </View>

        {syncError && <Text style={styles.error}>{syncError}</Text>}

        <View style={styles.sep} />
        <ActionRow
          icon="sync-outline"
          label="Sync now"
          disabled={syncing}
          onPress={() => void syncNow()}
        />
        <View style={styles.sep} />
        <ActionRow icon="log-out-outline" label="Sign out" danger onPress={() => void signOut()} />
      </View>
    );
  }

  // Signed out — a call-to-action row that opens a full sign-in page (modal).
  return (
    <>
      <View style={styles.card}>
        <ActionRow
          icon="cloud-upload-outline"
          label="Back up & sync"
          sub="Sign in to keep your items across devices"
          onPress={() => setExpanded(true)}
          chevron
        />
      </View>

      <Modal
        visible={expanded}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeForm}
      >
        <SafeAreaView style={styles.page} edges={['top', 'bottom']}>
          <View style={styles.pageHeader}>
            <Pressable accessibilityLabel="Close" hitSlop={10} onPress={closeForm} style={styles.pageBack}>
              <Ionicons name="chevron-down" size={26} color={colors.textMute} />
            </Pressable>
            <Text style={styles.pageTitle}>Back up & sync</Text>
            <View style={styles.pageBack} />
          </View>

          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.flex}
          >
            <ScrollView contentContainerStyle={styles.pageBody} keyboardShouldPersistTaps="handled">
              <View style={styles.heroIcon}>
                <Ionicons name="cloud-upload" size={30} color={colors.primary} />
              </View>
              <Text style={styles.pageLead}>
                {mode === 'signIn'
                  ? 'Sign in to keep your items backed up and synced across devices.'
                  : 'Create an account to back up your items and sync across devices.'}
              </Text>

              <View style={styles.field}>
                <Ionicons name="mail-outline" size={18} color={colors.textFaint} />
                <TextInput
                  accessibilityLabel="Email for cloud sync"
                  autoCapitalize="none"
                  autoComplete="email"
                  editable={!busy}
                  keyboardType="email-address"
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  placeholderTextColor={colors.textFaint}
                  returnKeyType="next"
                  style={styles.input}
                  value={email}
                />
              </View>

              <View style={styles.field}>
                <Ionicons name="lock-closed-outline" size={18} color={colors.textFaint} />
                <TextInput
                  accessibilityLabel="Password"
                  autoCapitalize="none"
                  autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
                  editable={!busy}
                  onChangeText={setPassword}
                  onSubmitEditing={() => void submitEmail()}
                  placeholder="Password (6+ characters)"
                  placeholderTextColor={colors.textFaint}
                  returnKeyType="done"
                  secureTextEntry
                  style={styles.input}
                  value={password}
                />
              </View>

              {(message || syncError) && (
                <Text style={message?.startsWith('Account created') ? styles.pageSuccess : styles.pageError}>
                  {message || syncError}
                </Text>
              )}

              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => void submitEmail()}
                style={({ pressed }) => [styles.primaryBtn, busy && styles.btnDisabled, pressed && styles.pressed]}
              >
                {busy ? (
                  <ActivityIndicator color={colors.onPrimary} size="small" />
                ) : (
                  <Text style={styles.primaryBtnText}>{mode === 'signIn' ? 'Sign in' : 'Create account'}</Text>
                )}
              </Pressable>

              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => {
                  setMode(mode === 'signIn' ? 'signUp' : 'signIn');
                  setMessage(null);
                }}
                style={styles.linkWrap}
              >
                <Text style={styles.link}>
                  {mode === 'signIn' ? 'New here? Create an account' : 'Have an account? Sign in'}
                </Text>
              </Pressable>

              <View style={styles.dividerRow}>
                <View style={styles.divider} />
                <Text style={styles.dividerText}>or</Text>
                <View style={styles.divider} />
              </View>

              <View style={styles.socialRow}>
                <SocialButton icon="logo-google" label="Google" disabled={busy} onPress={() => void submitProvider('google')} />
                <SocialButton icon="logo-facebook" label="Facebook" disabled={busy} onPress={() => void submitProvider('facebook')} />
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

function IconTile({ name, muted, danger }: { name: any; muted?: boolean; danger?: boolean }) {
  return (
    <View style={[styles.iconTile, danger && styles.iconTileDanger, muted && styles.iconTileMuted]}>
      <Ionicons
        name={name}
        size={18}
        color={danger ? colors.danger : muted ? colors.textMute : colors.primary}
      />
    </View>
  );
}

function ActionRow({
  icon,
  label,
  sub,
  onPress,
  danger,
  disabled,
  chevron,
}: {
  icon: any;
  label: string;
  sub?: string;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
  chevron?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.row, disabled && styles.btnDisabled, pressed && styles.rowPressed]}
    >
      <IconTile name={icon} danger={danger} />
      <View style={styles.rowCopy}>
        <Text style={[styles.rowLabel, danger && { color: colors.danger }]}>{label}</Text>
        {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      </View>
      {chevron && <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />}
    </Pressable>
  );
}

function SocialButton({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: any;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.socialBtn, disabled && styles.btnDisabled, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={18} color={colors.text} />
      <Text style={styles.socialText}>{label}</Text>
    </Pressable>
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
  iconTileMuted: { backgroundColor: 'rgba(139, 169, 181, 0.12)' },
  iconTileDanger: { backgroundColor: colors.dangerSoft },

  avatar: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.borderBright,
  },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.warning },
  dotOk: { backgroundColor: colors.success },

  // Presented sign-in page (modal).
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
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  input: { flex: 1, color: colors.text, paddingVertical: 14, fontSize: font.md },

  primaryBtn: {
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  primaryBtnText: { color: colors.onPrimary, fontSize: font.md, fontWeight: '800' },
  linkWrap: { alignItems: 'center', paddingVertical: spacing.sm },
  link: { color: colors.primary, fontSize: font.sm, fontWeight: '600' },

  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginVertical: spacing.xs },
  divider: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { color: colors.textFaint, fontSize: font.xs },
  socialRow: { flexDirection: 'row', gap: spacing.sm },
  socialBtn: {
    flex: 1,
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  socialText: { color: colors.text, fontSize: font.sm, fontWeight: '700' },

  btnDisabled: { opacity: 0.45 },
  pressed: { opacity: 0.7 },
  error: {
    color: colors.danger,
    fontSize: font.xs,
    lineHeight: 18,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  pageError: { color: colors.danger, fontSize: font.sm, lineHeight: 20 },
  pageSuccess: { color: colors.success, fontSize: font.sm, lineHeight: 20 },
});
