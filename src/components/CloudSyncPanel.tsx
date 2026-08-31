import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { colors, font, spacing } from '../theme';
import { isSupabaseConfigured, useStore } from '../store/useStore';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formatSyncTime(value: string | null): string {
  if (!value) return 'ยังไม่เคยซิงก์';
  return new Intl.DateTimeFormat('th-TH', {
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
  const userEmail = useStore((state) => state.userEmail);
  const syncing = useStore((state) => state.syncing);
  const syncError = useStore((state) => state.syncError);
  const lastSyncedAt = useStore((state) => state.lastSyncedAt);
  const pendingCount = useStore((state) =>
    state.pendingOps.filter((op) => op.userId === state.userId).length,
  );
  const requestOtp = useStore((state) => state.requestOtp);
  const verifyOtp = useStore((state) => state.verifyOtp);
  const signOut = useStore((state) => state.signOut);
  const syncNow = useStore((state) => state.syncNow);
  const clearSyncError = useStore((state) => state.clearSyncError);

  const [expanded, setExpanded] = useState(false);
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const sendCode = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(cleanEmail)) {
      setMessage('กรุณาใส่อีเมลให้ถูกต้อง');
      return;
    }

    setBusy(true);
    setMessage(null);
    clearSyncError();
    const result = await requestOtp(cleanEmail);
    setBusy(false);
    if (result.error) {
      setMessage(result.error);
      return;
    }
    setEmail(cleanEmail);
    setCodeSent(true);
    setMessage('ส่งรหัส 6 หลักแล้ว กรุณาตรวจอีเมล');
  };

  const confirmCode = async () => {
    if (!/^\d{6}$/.test(token.trim())) {
      setMessage('กรุณาใส่รหัส 6 หลัก');
      return;
    }

    setBusy(true);
    setMessage(null);
    clearSyncError();
    const result = await verifyOtp(email, token);
    setBusy(false);
    if (result.error) {
      setMessage(result.error);
      return;
    }
    setToken('');
    setCodeSent(false);
    setExpanded(false);
  };

  if (!configured) {
    return (
      <View style={styles.panel}>
        <PanelHeading status="LOCAL ONLY" />
        <Text style={styles.muted}>
          ยังไม่ได้ตั้งค่า Supabase · ข้อมูลยังเก็บในเครื่องและใช้ออฟไลน์ได้ครบ
        </Text>
      </View>
    );
  }

  if (syncMode === 'cloud' && userEmail) {
    return (
      <View style={styles.panel}>
        <PanelHeading status={syncing ? 'SYNCING' : pendingCount ? 'PENDING' : 'CONNECTED'} />
        <View style={styles.accountRow}>
          <View style={styles.accountCopy}>
            <Text style={styles.accountEmail} numberOfLines={1}>{userEmail}</Text>
            <Text style={styles.muted}>
              {syncing
                ? 'กำลังซิงก์ข้อมูล...'
                : `${formatSyncTime(lastSyncedAt)}${pendingCount ? ` · รอส่ง ${pendingCount}` : ''}`}
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
            เข้าสู่ระบบเพื่อสำรองและซิงก์รายการข้ามเครื่อง
          </Text>
          <ActionButton label="CONNECT" onPress={() => setExpanded(true)} />
        </View>
      ) : (
        <View style={styles.form}>
          <TextInput
            accessibilityLabel="อีเมลสำหรับ Cloud Sync"
            autoCapitalize="none"
            autoComplete="email"
            editable={!busy && !codeSent}
            keyboardType="email-address"
            onChangeText={setEmail}
            onSubmitEditing={() => void sendCode()}
            placeholder="you@example.com"
            placeholderTextColor={colors.textFaint}
            returnKeyType="send"
            style={styles.input}
            value={email}
          />

          {codeSent && (
            <TextInput
              accessibilityLabel="รหัส OTP 6 หลัก"
              autoComplete="one-time-code"
              keyboardType="number-pad"
              maxLength={6}
              onChangeText={(value) => setToken(value.replace(/\D/g, ''))}
              onSubmitEditing={() => void confirmCode()}
              placeholder="รหัส 6 หลัก"
              placeholderTextColor={colors.textFaint}
              returnKeyType="done"
              style={[styles.input, styles.codeInput]}
              value={token}
            />
          )}

          {(message || syncError) && (
            <Text style={message?.startsWith('ส่งรหัส') ? styles.success : styles.error}>
              {message || syncError}
            </Text>
          )}

          <View style={styles.actionRow}>
            <ActionButton
              label={busy ? 'PLEASE WAIT' : codeSent ? 'VERIFY OTP' : 'SEND OTP'}
              disabled={busy}
              onPress={() => void (codeSent ? confirmCode() : sendCode())}
            />
            <ActionButton
              label="CANCEL"
              subtle
              disabled={busy}
              onPress={() => {
                setExpanded(false);
                setCodeSent(false);
                setToken('');
                setMessage(null);
              }}
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
      <Text style={styles.label}>CLOUD MEMORY</Text>
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
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  subtle?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        subtle && styles.buttonSubtle,
        disabled && styles.buttonDisabled,
        pressed && styles.buttonPressed,
      ]}
    >
      <Text style={[styles.buttonText, subtle && styles.buttonTextSubtle]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: 'rgba(5, 19, 27, 0.88)',
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
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
  input: {
    color: colors.text,
    backgroundColor: 'rgba(2, 12, 18, 0.85)',
    borderWidth: 1,
    borderColor: colors.borderBright,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: font.sm,
  },
  codeInput: { letterSpacing: 6, fontWeight: '800' },
  actionRow: { flexDirection: 'row', gap: spacing.sm },
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
  buttonDisabled: { opacity: 0.45 },
  buttonPressed: { opacity: 0.7 },
  buttonText: { color: colors.primaryBright, fontSize: 8, fontWeight: '800', letterSpacing: 1 },
  buttonTextSubtle: { color: colors.textMute },
  error: { color: colors.danger, fontSize: font.xs, lineHeight: 18 },
  success: { color: colors.success, fontSize: font.xs, lineHeight: 18 },
});
