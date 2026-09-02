import assert from 'node:assert/strict';

import { buildMessages } from '../src/brain/prompt.ts';
import { planLocalDelete } from '../src/brain/localDelete.ts';
import {
  isDeleteCancellation,
  isDeleteConfirmation,
  itemsForDeleteScope,
  resolveDeleteTarget,
} from '../src/store/delete.ts';
import type { Item } from '../src/store/types.ts';

function item(id: string, patch: Partial<Item> = {}): Item {
  return {
    id,
    household_id: null,
    type: 'reminder',
    title: id,
    body: null,
    start_at: null,
    end_at: null,
    all_day: false,
    recurrence: null,
    alert_mode: 'notification',
    remind_until_done: false,
    snooze_minutes: 10,
    max_attempts: 5,
    done: false,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    notificationIds: [],
    ...patch,
  };
}

const now = new Date('2026-08-31T12:00:00+07:00');
const fixtures = [
  item('past', { start_at: '2026-08-31T09:00:00+07:00' }),
  item('future', { start_at: '2026-08-31T18:00:00+07:00' }),
  item('range-active', {
    type: 'event',
    start_at: '2026-08-30T00:00:00+07:00',
    end_at: '2026-09-01T23:59:59+07:00',
  }),
  item('recurring', {
    start_at: '2026-08-01T09:00:00+07:00',
    recurrence: { freq: 'daily', byday: null, interval: 1 },
  }),
  item('all-day-today', {
    type: 'event',
    start_at: '2026-08-31T00:00:00+07:00',
    all_day: true,
  }),
  item('all-day-yesterday', {
    type: 'event',
    start_at: '2026-08-30T00:00:00+07:00',
    all_day: true,
  }),
  item('done', { done: true }),
];

assert.deepEqual(itemsForDeleteScope(fixtures, 'past', now).map((value) => value.id), [
  'past',
  'all-day-yesterday',
]);
assert.deepEqual(itemsForDeleteScope(fixtures, 'done', now).map((value) => value.id), ['done']);
assert.equal(itemsForDeleteScope(fixtures, 'all', now).length, fixtures.length);
assert.equal(isDeleteConfirmation('ยืนยันครับ'), true);
assert.equal(isDeleteConfirmation('ลบเลย'), true);
assert.equal(isDeleteCancellation('ไม่ลบครับ'), true);
assert.equal(isDeleteConfirmation('ลบนัดหมอ'), false);
assert.equal(resolveDeleteTarget('future', fixtures)?.id, 'future');
assert.equal(resolveDeleteTarget('range', fixtures)?.id, 'range-active');
assert.equal(resolveDeleteTarget('item', [item('item-a'), item('item-b')]), null);

const localBulk = planLocalDelete('ลบรายการที่เลยไปแล้ว', fixtures);
assert.equal(localBulk?.actions[0].tool, 'delete_items');
assert.equal(localBulk?.actions[0].delete_scope, 'past');
assert.equal(planLocalDelete('ลบรายการที่เลยไปแล้วครับ', fixtures)?.actions[0].delete_scope, 'past');
const localSingle = planLocalDelete('ลบรายการ future ให้หน่อยครับ', fixtures);
assert.equal(localSingle?.actions[0].tool, 'delete_item');
assert.equal(localSingle?.actions[0].target_ref, 'future');
const localOrdinal = planLocalDelete('ลบอันแรก', fixtures, [
  { ref: 'future', label: 'future' },
  { ref: 'past', label: 'past' },
]);
assert.equal(localOrdinal?.actions[0].target_ref, 'future');

const messages = buildMessages('ลบนัดหมอ', now, {
  referents: [],
  inventory: [{ ref: 'dentist-1', label: 'นัดหมอฟัน — 1 ก.ย. 16:00' }],
});
assert.match(messages[1].content, /รายการทั้งหมดปัจจุบัน/);
assert.match(messages[1].content, /\[ref=dentist-1\] นัดหมอฟัน/);

console.log('✓ local delete planning, scope, confirmation, cancellation, and inventory context');
