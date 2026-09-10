import { eventItem } from './view';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { calendarApi, connectCloud } from './api';
import { appleEvents, appleSources } from './apple';
import { dedupeEvents, defaultRange, sourceKey, validRange } from './model';
import type { CalendarEvent, CalendarSource, Connection, Provider } from './model';
interface State {
  owner: string | null; selected: string[]; sources: CalendarSource[]; connections: Connection[];
  events: CalendarEvent[]; appleConnected: boolean; busy: boolean; hydrated: boolean;
  error: string | null; serviceError: string | null; lastSynced: string | null; range: { start: string; end: string } | null;
}
const blank = { selected: [], sources: [], connections: [], events: [], appleConnected: false, busy: false, hydrated: false, error: null, serviceError: null, lastSynced: null, range: null };
export const useCalendars = create<State>(() => ({ owner: null, ...blank }));
let generation = 0;
let queue: Promise<unknown> = Promise.resolve();
const storageKey = (owner: string) => `vora-calendars-v1:${owner}`;
const save = async () => {
  const { owner, selected, appleConnected } = useCalendars.getState();
  if (owner) await AsyncStorage.setItem(storageKey(owner), JSON.stringify({ selected, appleConnected }));
};
export async function activateCalendars(userId: string | null) {
  const owner = userId ?? 'local', version = ++generation;
  useCalendars.setState({ ...blank, owner });
  const raw = await AsyncStorage.getItem(storageKey(owner)).catch(() => null);
  if (version !== generation) return;
  let saved: { selected?: string[]; appleConnected?: boolean } = {};
  try { saved = raw ? JSON.parse(raw) : {}; } catch { /* reset invalid preferences */ }
  useCalendars.setState({ selected: Array.isArray(saved.selected) ? saved.selected.filter(k => typeof k === 'string') : [], appleConnected: saved.appleConnected === true, hydrated: true });
  await refreshCalendars();
}
/** Serialized refresh avoids concurrent rotating-token requests; generation blocks stale account/selection results. */
export function refreshCalendars(range = useCalendars.getState().range ?? defaultRange()): Promise<void> {
  validRange(range.start, range.end);
  const version = generation;
  const run = async () => {
    const state = useCalendars.getState();
    if (!state.hydrated || version !== generation) return;
    useCalendars.setState({ busy: true });
    try {
      let connections: Connection[] = [];
      let serviceError: string | null = null;
      if (state.owner !== 'local') {
        try { connections = (await calendarApi<{ connections: Connection[] }>({ action: 'status' })).connections; }
        catch (e) {
          serviceError = e instanceof Error ? e.message : 'Calendar service unavailable.';
          if (state.selected.some(k => !k.startsWith('apple:'))) throw e;
        }
      }
      if (version === generation) useCalendars.setState({ connections, serviceError });
      const sources: CalendarSource[] = [], events: CalendarEvent[] = [];
      for (const provider of ['google', 'outlook', 'apple'] as const) {
        const ids = state.selected.filter(k => k.startsWith(`${provider}:`)).map(k => k.slice(provider.length + 1));
        const connected = provider === 'apple' ? state.appleConnected : connections.some(c => c.provider === provider && c.connected);
        if (!connected) {
          if (ids.length) throw new Error('A selected calendar was disconnected. Reconnect it or remove its selection.');
          continue;
        }
        const calendars = provider === 'apple' ? await appleSources()
          : (await calendarApi<{ calendars: CalendarSource[] }>({ action: 'calendars', provider })).calendars;
        sources.push(...calendars);
        if (version === generation) useCalendars.setState({ sources: [...sources, ...state.sources.filter(c => !sources.some(s => s.provider === c.provider))] });
        if (!ids.length) continue;
        const selected = ids.filter(id => calendars.some(c => c.id === id));
        if (selected.length !== ids.length) throw new Error('A selected calendar is no longer available. Choose calendars again or hide connected calendars.');
        const rows = provider === 'apple' ? await appleEvents(selected, range.start, range.end)
          : (await calendarApi<{ events: CalendarEvent[] }>({ action: 'events', provider, calendarIds: selected, ...range })).events;
        events.push(...rows);
      }
      if (version !== generation) return;
      await save();
      if (version !== generation) return;
      useCalendars.setState({ connections, sources, events: dedupeEvents(events), range, error: null, lastSynced: new Date().toISOString() });
    } catch (error) {
      if (version === generation) useCalendars.setState({ error: error instanceof Error ? error.message : 'Calendar sync failed.', events: [], range: null, lastSynced: null });
    } finally { if (version === generation) useCalendars.setState({ busy: false }); }
  };
  const next = queue.then(run, run); queue = next; return next;
}
export async function connectCalendar(provider: Provider) {
  if (provider !== 'apple') {
    // A reconnect can choose a different provider account. Opt in afresh so a
    // reused calendar id never imports that account without a source choice.
    generation++;
    const state = useCalendars.getState();
    useCalendars.setState({ selected: state.selected.filter(k => !k.startsWith(`${provider}:`)), events: state.events.filter(e => e.provider !== provider), busy: false });
    await save();
  }
  const version = generation;
  if (provider === 'apple') {
    const sources = await appleSources(true);
    if (version !== generation) return;
    useCalendars.setState({ appleConnected: true, sources: [...useCalendars.getState().sources.filter(c => c.provider !== 'apple'), ...sources] });
    await save();
  } else await connectCloud(provider);
  if (version === generation) await refreshCalendars();
}
export async function disconnectCalendar(provider: Provider) {
  const version = generation;
  if (provider !== 'apple') await calendarApi({ action: 'disconnect', provider });
  if (version !== generation) return;
  generation++;
  const state = useCalendars.getState();
  useCalendars.setState({ selected: state.selected.filter(k => !k.startsWith(`${provider}:`)), events: state.events.filter(e => e.provider !== provider), sources: state.sources.filter(c => c.provider !== provider), connections: state.connections.map(c => c.provider === provider ? { ...c, connected: false } : c), appleConnected: provider === 'apple' ? false : state.appleConnected, busy: false });
  await save(); await refreshCalendars();
}
export async function toggleCalendar(source: CalendarSource) {
  const state = useCalendars.getState(), key = sourceKey(source);
  const selected = state.selected.includes(key) ? state.selected.filter(k => k !== key) : [...state.selected, key];
  if (selected.filter(k => k.startsWith(`${source.provider}:`)).length > 30) throw new Error('Choose up to 30 calendars per provider.');
  generation++;
  useCalendars.setState({ selected, events: state.events.filter(e => selected.includes(sourceKey({ provider: e.provider, id: e.calendarId }))), busy: false });
  await save(); await refreshCalendars();
}
export function externalItems(owner: string | null, space: string | null) {
  const state = useCalendars.getState();
  return !space && state.owner === (owner ?? 'local') ? state.events.map(eventItem) : [];
}
/** Refresh before spoken schedule/free-time answers; missing data must not imply availability. */
export async function ensureCalendarRange(owner: string | null, start: string, end: string) {
  const state = useCalendars.getState();
  if (state.owner !== (owner ?? 'local') || !state.hydrated) throw new Error('Calendar preferences are loading. Please try again.');
  if (!state.selected.length) return;
  const version = generation;
  const combined = state.range ? {
    start: new Date(Math.min(Date.parse(state.range.start), Date.parse(start))).toISOString(),
    end: new Date(Math.max(Date.parse(state.range.end), Date.parse(end))).toISOString(),
  } : { start, end };
  await refreshCalendars(Date.parse(combined.end) - Date.parse(combined.start) <= 366 * 86400000 ? combined : { start, end });
  const current = useCalendars.getState();
  if (current.owner !== (owner ?? 'local')) throw new Error('Account changed. Please ask again.');
  if (version !== generation) throw new Error('Calendar selection changed. Please ask again.');
  if (current.error) throw new Error(current.error);
  if (!current.range || Date.parse(current.range.start) > Date.parse(start) || Date.parse(current.range.end) < Date.parse(end)) throw new Error('Calendar data is incomplete. Please try again.');
}

/** Local opt-out remains available even if provider access/server is unavailable. */
export async function hideCalendars() {
  generation++;
  useCalendars.setState({ selected: [], events: [], error: null, range: null, busy: false });
  await save();
}
