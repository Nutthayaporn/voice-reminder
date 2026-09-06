import { Pressable, Text, View } from 'react-native';
import type { Item } from '../store/types';
import type { SpaceMember } from '../domain/assignment';
import { occursOn } from '../domain/recurrence';
import { colors } from '../theme';
export function ItemActionsPanel({ item, members, onAssignment, onOccurrence }: { item: Item; members: SpaceMember[]; onAssignment: (assignee: string | null | undefined, recipients: string[] | null | undefined) => void; onOccurrence: (status: 'done' | 'skipped' | 'pending') => void }) {
  const style = { color: colors.text, padding: 10 };
  return <View>
    {item.household_id && <View><Text style={style}>ผู้รับผิดชอบ</Text>
      {[{ user_id: '', name: 'ยังไม่มอบหมาย' },...members].map((m) => <Pressable key={m.user_id} accessibilityRole="radio" accessibilityState={{ selected: (item.details?.assigned_to ?? '') === m.user_id }} onPress={() => onAssignment(m.user_id || null,undefined)}><Text style={style}>{(item.details?.assigned_to ?? '') === m.user_id ? '✓ ' : ''}{m.name}</Text></Pressable>)}
      <Text style={style}>ผู้ได้รับการเตือน (ทุกคนยังเห็นรายการ)</Text>
      <Pressable accessibilityRole="button" onPress={() => onAssignment(undefined,null)}><Text style={style}>{item.details?.notify_user_ids == null ? '✓ ' : ''}ทุกคน</Text></Pressable>
      {members.map((m) => { const selected = item.details?.notify_user_ids?.includes(m.user_id) ?? true; return <Pressable key={m.user_id} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={() => { const current = item.details?.notify_user_ids ?? members.map((m) => m.user_id); onAssignment(undefined, selected ? current.filter((id) => id !== m.user_id) : [...current,m.user_id]); }}><Text style={style}>{selected ? '✓ ' : ''}{m.name}</Text></Pressable>; })}
    </View>}
    {item.recurrence && <View><Text style={style}>เฉพาะรอบวันนี้{!occursOn(item, new Date()) ? ' · วันนี้ไม่มีรอบ' : ''}</Text>{(['done','skipped','pending'] as const).map((status) => <Pressable key={status} accessibilityRole="button" disabled={!occursOn(item, new Date())} onPress={() => onOccurrence(status)}><Text style={style}>{status === 'done' ? 'ทำแล้ววันนี้' : status === 'skipped' ? 'ข้ามวันนี้' : 'เปิดรอบวันนี้อีกครั้ง'}</Text></Pressable>)}
      <Text style={style}>บนมือถือ รอบที่มีการข้ามหรือทำแล้วจะเตรียมเตือนล่วงหน้าสูงสุด 8 รอบ เปิดแอปเป็นระยะเพื่อเติมรอบถัดไป</Text>
      {Object.entries(item.details?.occurrences ?? {}).sort().reverse().map(([day,status]) => <Text key={day} style={style}>{day} · {status === 'done' ? 'ทำแล้ว' : 'ข้าม'}</Text>)}
    </View>}
  </View>;
}
