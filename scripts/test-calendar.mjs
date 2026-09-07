import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
// Execute the real pure model and store with deterministic provider/storage adapters.
function harness() {
  const cache = new Map(), disk = new Map();
  let fail = false, gate = null;
  const source = { id: 'primary', name: 'Personal', provider: 'google' };
  const event = { id: 'event-1', calendarId: 'primary', provider: 'google', title: 'Meeting', start: '2026-09-07T03:00:00Z', end: '2026-09-07T04:00:00Z', allDay: false, busy: true };
  const api = async body => {
    if (gate && body.action === 'events') await gate;
    if (fail) throw new Error('Calendar access was revoked.');
    if (body.action === 'status') return { connections: [{ provider: 'google', connected: true, ready: true }] };
    if (body.action === 'calendars') return { calendars: [source] };
    if (body.action === 'events') return { events: [event] };
    return {};
  };
  const mocks = {
    '@react-native-async-storage/async-storage': { __esModule: true, default: { getItem: async k => disk.get(k) ?? null, setItem: async (k,v) => { disk.set(k,v); } } },
    zustand: { create: init => {
      let state = init();
      const store = () => state;
      store.getState = () => state;
      store.setState = patch => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; };
      return store;
    } },
    './api': { calendarApi: api, connectCloud: async () => {} },
    './apple': { appleSources: async () => [{ id: 'apple-1', provider: 'apple', name: 'iCloud' }], appleEvents: async () => [{ ...event, provider: 'apple', calendarId: 'apple-1' }] },
  };
  function load(file) {
    file = path.resolve(file);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file,module);
    const code = ts.transpileModule(fs.readFileSync(file,'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const require = name => {
      if (mocks[name]) return mocks[name];
      const resolved = path.resolve(path.dirname(file), name);
      return load(path.extname(resolved) ? resolved : `${resolved}.ts`);
    };
    new Function('require','module','exports', code)(require,module,module.exports);
    return module.exports;
  }
  return { load, disk, source, event, fail: value => { fail = value; }, gate: value => { gate = value; } };
}
const h = harness();
const model = h.load('src/integrations/calendar/model.ts');
const { eventItem } = h.load('src/integrations/calendar/view.ts');
const { occursOn } = h.load('src/domain/recurrence.ts');
const { planLocalDelete } = h.load('src/brain/localDelete.ts');
assert.deepEqual(planLocalDelete('ลบอันแรก', [eventItem(h.event)], [{ ref: 'external:google:one', label: 'Meeting' }]).actions, [], 'external ordinal must not fall back to deleting a local item');
const { busySlots } = h.load('src/domain/availability.ts');
const allDay = model.googleEvent({ id: 'day', start: { date: '2026-09-07' }, end: { date: '2026-09-09' }, summary: 'Trip' }, 'primary');
assert.equal(occursOn(eventItem(allDay), new Date('2026-09-08T12:00:00+07:00')), true);
assert.equal(occursOn(eventItem(allDay), new Date('2026-09-09T12:00:00+07:00')), false, 'all-day exclusive end must not spill into the next day');
assert.equal(model.googleEvent({ status: 'cancelled' }, 'primary'), null);
assert.equal(model.googleEvent({ attendees: [{ self: true, responseStatus: 'declined' }] }, 'primary'), null);
assert.equal(model.outlookEvent({ isCancelled: true }, 'primary'), null);
const outlook = model.outlookEvent({ id: 'o', subject: 'Call', start: { dateTime: '2026-09-07T03:00:00.0000000' }, end: { dateTime: '2026-09-07T04:00:00.0000000' }, showAs: 'free' }, 'c');
assert.equal(new Date(outlook.start).toISOString(), '2026-09-07T03:00:00.000Z');
assert.deepEqual(busySlots([eventItem(outlook)], new Date('2026-09-07'), new Date('2026-09-08')), [], 'free calendar events must not block availability');
const duplicates = [{ ...h.event, uid: 'shared' }, { ...h.event, provider: 'apple', uid: 'shared' }];
assert.equal(model.dedupeEvents(duplicates).length,1);
assert.equal(model.dedupeEvents([{ ...h.event }, { ...h.event, id:'different', provider:'apple' }]).length,2, 'same title/time without a UID must not hide a distinct event');
assert.equal(model.dedupeEvents([...duplicates, { ...h.event, uid: 'shared', start: '2026-09-08T03:00:00Z', end: '2026-09-08T04:00:00Z' }]).length,2, 'recurring occurrences must stay separate');
assert.throws(() => model.googleEvent({ id:'bad', start:{ dateTime:'invalid' } },'c'));
assert.throws(() => model.validRange('2026-09-08','2026-09-07'));
const store = h.load('src/integrations/calendar/store.ts');
await store.activateCalendars('user-a');
assert.equal(store.externalItems('user-a',null).length,0,'no automatic calendar opt-in');
await store.toggleCalendar(h.source);
assert.equal(store.externalItems('user-a',null).length,1);
assert.equal(store.externalItems('user-b',null).length,0,'account isolation');
assert.equal(store.externalItems('user-a','household').length,0,'no sharing external calendars');
assert.deepEqual(store.externalItems('user-a',null)[0].notificationIds,[]);
await store.toggleCalendar(h.source);
assert.equal(store.externalItems('user-a',null).length,0,'deselection removes events');
await store.toggleCalendar(h.source);
h.fail(true);
await assert.rejects(store.ensureCalendarRange('user-a','2026-09-07','2026-09-08'), /revoked/);
assert.equal(store.externalItems('user-a',null).length,0,'failed sync cannot advertise stale free time');
h.fail(false);
let release;
h.gate(new Promise(resolve => { release = resolve; }));
const oldRefresh = store.refreshCalendars();
await new Promise(resolve => setTimeout(resolve,0));
const switching = store.activateCalendars('user-b');
release(); await oldRefresh; await switching;
assert.equal(store.externalItems('user-b',null).length,0,'late response cannot populate another account');
h.gate(null);
await store.activateCalendars('user-a');
assert.equal(store.useCalendars.getState().selected.length,1,'selection restored per account');
await store.disconnectCalendar('google');
assert.equal(store.useCalendars.getState().selected.length,0);
assert.equal(store.externalItems('user-a',null).length,0);
const apple = harness(); apple.fail(true);
apple.disk.set('vora-calendars-v1:apple-user',JSON.stringify({ appleConnected:true,selected:['apple:apple-1'] }));
const appleStore = apple.load('src/integrations/calendar/store.ts');
await appleStore.activateCalendars('apple-user');
assert.equal(appleStore.externalItems('apple-user',null).length,1,'Apple works even when cloud service is not configured');
assert.equal(appleStore.useCalendars.getState().error,null);
await appleStore.hideCalendars();
assert.equal(appleStore.externalItems('apple-user',null).length,0,'local opt-out works offline');
console.log('Calendar checks passed: normalization, cancellations, all-day boundaries, busy/free, dedupe, opt-in, account/space isolation, stale responses, disconnect, failure handling, and independent Apple access.');
