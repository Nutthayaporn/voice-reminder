import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { colors, font, radius, spacing } from '../theme';
import { isSupabaseConfigured, useStore } from '../store/useStore';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formatSyncTime(value: string | null): string {
  if (!value) return 'Never synced';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function CloudSyncPanel() {
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

  if (!configured) {
    return (
      <View style={styles.panel}>
        <PanelHeading status="LOCAL ONLY" />
        <Text style={styles.muted}>
          Supabase is not configured. Your data stays on this device and remains available offline.
        </Text>
      </View>
    );
  }

  if (syncMode === 'cloud' && userId) {
    return (
      <View style={styles.panel}>
        <PanelHeading status={syncing ? 'SYNCING' : pendingCount ? 'PENDING' : 'CONNECTED'} />
        <View style={styles.accountRow}>
          <View style={styles.accountCopy}>
            <Text style={styles.accountEmail} numberOfLines={1}>
              {userEmail || 'Signed-in account'}
            </Text>
            <Text style={styles.muted}>
              {syncing
                ? 'Syncing data...'
                : `${formatSyncTime(lastSyncedAt)}${pendingCount ? ` · ${pendingCount} pending` : ''}`}
            </Text>
          </View>
          {syncing && <ActivityIndicator color={colors.primary} size="small" />}
        </View>

        {syncError && <Text style={styles.error}>{syncError}</Text>}

        <View style={styles.actionRow}>
          <ActionButton
            label="SYNC NOW"
            disabled={syncing}
            onPress={() => void syncNow()}
          />
          <ActionButton label="SIGN OUT" subtle onPress={() => void signOut()} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.panel}>
      <PanelHeading status="LOCAL ONLY" />
      {!expanded ? (
        <View style={styles.accountRow}>
          <Text style={[styles.muted, styles.accountCopy]}>
            Sign in to back up and sync your items across devices.
          </Text>
          <ActionButton label="SIGN IN" onPress={() => setExpanded(true)} />
        </View>
      ) : (
        <View style={styles.form}>
          <View style={styles.modeRow}>
            <ModeButton
              active={mode === 'signIn'}
              label="SIGN IN"
              onPress={() => {
                setMode('signIn');
                setMessage(null);
              }}
            />
            <ModeButton
              active={mode === 'signUp'}
              label="CREATE ACCOUNT"
              onPress={() => {
                setMode('signUp');
                setMessage(null);
              }}
            />
          </View>

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

          {(message || syncError) && (
            <Text style={message?.startsWith('Account created') ? styles.success : styles.error}>
              {message || syncError}
            </Text>
          )}

          <View style={styles.actionRow}>
            <ActionButton
              label={busy ? 'PLEASE WAIT' : mode === 'signIn' ? 'SIGN IN' : 'SIGN UP'}
              disabled={busy}
              grow
              onPress={() => void submitEmail()}
            />
            <ActionButton
              label="CANCEL"
              subtle
              disabled={busy}
              onPress={() => {
                setExpanded(false);
                setPassword('');
                setMessage(null);
              }}
            />
          </View>

          <View style={styles.dividerRow}>
            <View style={styles.divider} />
            <Text style={styles.dividerText}>OR CONTINUE WITH</Text>
            <View style={styles.divider} />
          </View>

          <View style={styles.socialRow}>
            <ActionButton
              label="GOOGLE"
              disabled={busy}
              grow
              onPress={() => void submitProvider('google')}
            />
            <ActionButton
              label="FACEBOOK"
              disabled={busy}
              grow
              onPress={() => void submitProvider('facebook')}
            />
          </View>
        </View>
      )}
    </View>
  );
}

function PanelHeading({ status }: { status: string }) {
  const active = status === 'CONNECTED';
  return (
    <View style={styles.heading}>
      <Text style={styles.label}>ACCOUNT & SYNC</Text>
      <View style={styles.statusRow}>
        <View style={[styles.statusDot, active && styles.statusDotActive]} />
        <Text style={[styles.status, active && styles.statusActive]}>{status}</Text>
      </View>
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  disabled = false,
  subtle = false,
  grow = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  subtle?: boolean;
  grow?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        subtle && styles.buttonSubtle,
        grow && styles.buttonGrow,
        disabled && styles.buttonDisabled,
        pressed && styles.buttonPressed,
      ]}
    >
      <Text style={[styles.buttonText, subtle && styles.buttonTextSubtle]}>{label}</Text>
    </Pressable>
  );
}

function ModeButton({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.modeButton, active && styles.modeButtonActive]}
    >
      <Text style={[styles.modeButtonText, active && styles.modeButtonTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  label: { color: colors.textFaint, fontSize: 8, fontWeight: '700', letterSpacing: 1.5 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.warning,
  },
  statusDotActive: { backgroundColor: colors.success },
  status: { color: colors.warning, fontSize: 8, fontWeight: '800', letterSpacing: 1 },
  statusActive: { color: colors.success },
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  accountCopy: { flex: 1, minWidth: 0, gap: 3 },
  accountEmail: { color: colors.text, fontSize: font.sm, fontWeight: '700' },
  muted: { color: colors.textMute, fontSize: font.xs, lineHeight: 18 },
  form: { gap: spacing.sm },
  modeRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border },
  modeButton: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm },
  modeButtonActive: { borderBottomWidth: 2, borderBottomColor: colors.primary },
  modeButtonText: { color: colors.textMute, fontSize: 8, fontWeight: '800', letterSpacing: 1 },
  modeButtonTextActive: { color: colors.primaryBright },
  input: {
    color: colors.text,
    backgroundColor: 'rgba(2, 12, 18, 0.85)',
    borderWidth: 1,
    borderColor: colors.borderBright,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: font.sm,
  },
  actionRow: { flexDirection: 'row', gap: spacing.sm },
  socialRow: { flexDirection: 'row', gap: spacing.sm },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  divider: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { color: colors.textFaint, fontSize: 7, fontWeight: '700', letterSpacing: 1 },
  button: {
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.primaryDark,
    backgroundColor: colors.primarySoft,
  },
  buttonSubtle: { borderColor: colors.border, backgroundColor: 'transparent' },
  buttonGrow: { flex: 1 },
  buttonDisabled: { opacity: 0.45 },
  buttonPressed: { opacity: 0.7 },
  buttonText: { color: colors.primaryBright, fontSize: 8, fontWeight: '800', letterSpacing: 1 },
  buttonTextSubtle: { color: colors.textMute },
  error: { color: colors.danger, fontSize: font.xs, lineHeight: 18 },
  success: { color: colors.success, fontSize: font.xs, lineHeight: 18 },
});
