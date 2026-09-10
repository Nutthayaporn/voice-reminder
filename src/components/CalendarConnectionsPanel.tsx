import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, radius, spacing } from '../theme';
import { useStore } from '../store/useStore';
import { appleAvailable } from '../integrations/calendar/apple';
import { connectCalendar, disconnectCalendar, hideCalendars, refreshCalendars, toggleCalendar, useCalendars } from '../integrations/calendar/store';
import { providerNames, sourceKey } from '../integrations/calendar/model';
import type { Provider } from '../integrations/calendar/model';
import type { Item } from '../store/types';

const providerIcons: Record<Provider, keyof typeof Ionicons.glyphMap> = {
  google: 'logo-google',
  outlook: 'mail-outline',
  apple: 'logo-apple',
};

export function calendarProviders(): Provider[] {
  return Platform.OS === 'ios' ? ['google', 'outlook', 'apple'] : ['google', 'outlook'];
}

/** Second-level menu: one row per calendar provider, drilling into its detail. */
export function CalendarProviderMenu({ onSelect }: { onSelect: (provider: Provider) => void }) {
  const userId = useStore(s => s.userId);
  const state = useCalendars();
  return (
    <View style={styles.menuGroup}>
      {calendarProviders().map((provider, index) => {
        const connection = state.connections.find(c => c.provider === provider);
        const connected = provider === 'apple'
          ? state.appleConnected
          : !!connection?.connected || state.selected.some(k => k.startsWith(`${provider}:`));
        const count = state.selected.filter(k => k.startsWith(`${provider}:`)).length;
        return (
          <View key={provider}>
            {index > 0 && <View style={styles.menuSep} />}
            <Pressable
              accessibilityRole="button"
              onPress={() => onSelect(provider)}
              style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}
            >
              <View style={styles.menuIcon}>
                <Ionicons name={providerIcons[provider]} size={18} color={colors.primary} />
              </View>
              <View style={styles.menuCopy}>
                <Text style={styles.menuLabel}>{providerNames[provider]}</Text>
                <Text style={styles.menuSub} numberOfLines={1}>
                  {connected ? (count ? `Connected · ${count} calendar${count > 1 ? 's' : ''}` : 'Connected') : 'Not connected'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}
export function ExternalEventRow({ item }: { item: Item }) {
  const external = item.externalCalendar!;
  const time = item.all_day ? 'All day' : new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }).format(new Date(item.start_at!));
  return <View style={styles.event}>
    <Text style={styles.label}>{item.title}</Text>
    <Text style={styles.hint}>{time} · {providerNames[external.provider]} · Read only{!external.busy ? ' · Free' : ''}</Text>
  </View>;
}
export function CalendarConnectionsPanel({ only }: { only?: Provider } = {}) {
  const userId = useStore(s => s.userId);
  const state = useCalendars();
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const url = new URL(window.location.href), result = url.searchParams.get('calendar_result');
    if (!result) return;
    setMessage(result === 'connected' ? 'Account connected. Choose which calendars to include.' : 'Calendar connection was not completed. Try again.');
    url.searchParams.delete('calendar_result'); window.history.replaceState(null, '', url.href);
  }, []);
  const busy = working || state.busy || !state.hydrated;
  const run = async (task: () => Promise<void>) => {
    setWorking(true); setMessage('');
    try { await task(); } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
    finally { setWorking(false); }
  };
  const providers: Provider[] = only ? [only] : calendarProviders();
  return <View style={styles.card}>
    <Text style={styles.label}>Connected calendars</Text>
    <Text style={styles.hint}>Read selected calendars in your personal space and ask VORA about your schedule. Events stay read only; reminders remain with the original calendar.</Text>
    {providers.map(provider => {
      const connection = state.connections.find(c => c.provider === provider);
      const connected = provider === 'apple' ? state.appleConnected : !!connection?.connected || state.selected.some(k => k.startsWith(`${provider}:`));
      const available = provider === 'apple' ? appleAvailable() : !!userId && !!connection?.ready;
      const hint = provider === 'apple' ? (available ? 'Calendars on this iPhone' : 'Requires a new iOS development build')
        : !userId ? 'Sign in to VORA first' : !connection?.ready ? 'Connection setup is pending' : 'Connect your personal or work account';
      return <View key={provider} style={styles.provider}>
        <Text style={styles.label}>{providerNames[provider]}</Text>
        <Text style={styles.hint}>{connected ? 'Connected · Choose calendars below' : hint}</Text>
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" disabled={busy || !available} onPress={() => void run(() => connectCalendar(provider))} style={[styles.button, (busy || !available) && styles.disabled]}><Text style={styles.buttonText}>{connected ? 'Reconnect' : `Connect ${providerNames[provider]}`}</Text></Pressable>
          {connected && <Pressable accessibilityRole="button" disabled={busy} onPress={() => void run(() => disconnectCalendar(provider))} style={styles.button}><Text style={styles.buttonText}>Disconnect</Text></Pressable>}
        </View>
        {connected && state.sources.filter(c => c.provider === provider).map(source => <View key={sourceKey(source)} style={styles.source}>
          <View style={{ flex: 1 }}><Text style={styles.label}>{source.name}</Text>{!!source.account && <Text style={styles.hint}>{source.account}</Text>}</View>
          <Switch accessibilityLabel={`Include ${source.name} from ${providerNames[provider]}`} disabled={busy} value={state.selected.includes(sourceKey(source))} onValueChange={() => void run(() => toggleCalendar(source))} trackColor={{ false: colors.border, true: colors.primaryDark }} />
        </View>)}
      </View>;
    })}
    {Platform.OS === 'ios' && <Text style={styles.hint}>If Google or Outlook is also on this iPhone, select that calendar through one connection only to avoid duplicates.</Text>}
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => void run(() => refreshCalendars())} style={styles.button}><Text style={styles.buttonText}>Refresh calendars</Text></Pressable>
    {!!state.selected.length && <Pressable accessibilityRole="button" disabled={working} onPress={() => void run(hideCalendars)} style={styles.button}><Text style={styles.buttonText}>Hide all connected calendars</Text></Pressable>}
    {busy && <ActivityIndicator color={colors.primary} />}
    <Text style={styles.hint}>{state.selected.length} selected · Refreshes while VORA is open and before schedule questions.</Text>
    {state.lastSynced && <Text style={styles.hint}>Last checked: {new Date(state.lastSynced).toLocaleString()}</Text>}
    {!!(message || state.error || state.serviceError) && <Text accessibilityLiveRegion="polite" style={styles.error}>{message || state.error || state.serviceError}</Text>}
  </View>;
}
export function CalendarSyncNotice() {
  const state = useCalendars();
  if (!state.selected.length) return null;
  return <Text accessibilityLiveRegion="polite" style={styles.hint}>{state.busy ? 'Refreshing connected calendars…' : state.error ? `Connected calendars unavailable: ${state.error}` : state.range ? `Connected calendars: ${state.range.start.slice(0,10)} – ${state.range.end.slice(0,10)} · Read only` : 'Connected calendars have not loaded yet.'}</Text>;
}
const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: 16, gap: 12 },
  provider: { borderTopWidth: 1, borderColor: colors.border, paddingTop: 16, gap: 8 },
  label: { color: colors.text, fontSize: 15, fontWeight: '600' },
  hint: { color: colors.textMute, fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: { padding: 12, backgroundColor: colors.primarySoft, borderRadius: radius.md, alignSelf: 'flex-start' },
  buttonText: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  source: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  disabled: { opacity: 0.4 },
  error: { color: colors.warning, fontSize: 13, lineHeight: 19 },
  event: { padding: 16, gap: 6, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  menuGroup: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, overflow: 'hidden' },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 60, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  menuRowPressed: { backgroundColor: colors.cardRaised },
  menuIcon: { width: 34, height: 34, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  menuCopy: { flex: 1, minWidth: 0, gap: 2 },
  menuLabel: { color: colors.text, fontSize: font.md, fontWeight: '600' },
  menuSub: { color: colors.textMute, fontSize: font.xs, lineHeight: 16 },
  menuSep: { height: 1, backgroundColor: colors.border, marginLeft: 64 },
});
