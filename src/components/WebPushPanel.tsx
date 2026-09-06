import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useStore } from '../store/useStore';
import { pushSupported, pushEnabled, enableWebPush, disableWebPush, testWebPush } from '../notify/webPush';
import { colors, font, radius, spacing } from '../theme';

export function WebPushPanel() {
  const userId = useStore((s) => s.userId);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let live = true;
    void pushEnabled()
      .then((value) => { if (live) setEnabled(value); })
      .catch(() => { if (live) setEnabled(false); });
    return () => { live = false; };
  }, [userId]);

  if (Platform.OS !== 'web') return null;

  const supported = pushSupported();
  const canToggle = !!userId && supported;

  const run = async (task: () => Promise<void>, success: string) => {
    setBusy(true);
    setMessage('');
    try {
      await task();
      setEnabled(await pushEnabled());
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const status = !userId
    ? 'เข้าสู่ระบบก่อนเปิดการแจ้งเตือน'
    : !supported
      ? 'ใช้เบราว์เซอร์ที่รองรับผ่าน HTTPS — บน iPhone ให้เพิ่มแอปไว้ที่หน้าจอโฮมก่อน'
      : enabled
        ? 'เปิดแจ้งเตือนบนเบราว์เซอร์นี้แล้ว'
        : 'แจ้งเตือนแม้ปิดหน้าเว็บ';

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.iconTile}>
          <Ionicons name="notifications-circle-outline" size={18} color={colors.primary} />
        </View>
        <View style={styles.rowCopy}>
          <Text style={styles.rowLabel}>Web push</Text>
          <Text style={styles.rowSub}>{status}</Text>
        </View>
        {canToggle && (
          busy ? (
            <ActivityIndicator color={colors.primary} size="small" />
          ) : (
            <Switch
              value={enabled}
              onValueChange={() => void run(enabled ? disableWebPush : enableWebPush, 'บันทึกการตั้งค่าแล้ว')}
              trackColor={{ true: colors.primaryDark, false: colors.border }}
              thumbColor={enabled ? colors.primary : colors.textFaint}
            />
          )
        )}
      </View>

      {enabled && (
        <>
          <View style={styles.sep} />
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void run(testWebPush, 'ส่งคำขอทดสอบแล้ว ตรวจดูการแจ้งเตือนของเบราว์เซอร์')}
            style={({ pressed }) => [styles.row, busy && styles.disabled, pressed && styles.rowPressed]}
          >
            <View style={styles.iconTile}>
              <Ionicons name="paper-plane-outline" size={18} color={colors.primary} />
            </View>
            <Text style={[styles.rowLabel, { flex: 1 }]}>ส่งการแจ้งเตือนทดสอบ</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
          </Pressable>
        </>
      )}

      {!!message && (
        <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text>
      )}
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
  disabled: { opacity: 0.45 },
  message: {
    color: colors.textMute,
    fontSize: font.xs,
    lineHeight: 18,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
});
