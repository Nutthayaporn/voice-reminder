// Month grid for the Calendar tab. Buckets items by the Bangkok day(s) they
// cover (a dated event with an end spans every day in its range), renders a dot
// per busy day, and lets the user tap a day to drive the list below it. Pure
// presentational: the selected day and its item list live in the parent.

import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { Item } from '../store/types';
import { bkkDateStr } from '../lib/date';
import { colors, font, radius, spacing } from '../theme';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** 'YYYY-MM-DD' for a calendar cell — plain string math, no timezone drift. */
function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Every Bangkok day an item touches: its start day, through its end day. */
function itemDays(item: Item): string[] {
  if (!item.start_at) return [];
  const start = bkkDateStr(item.start_at);
  if (!item.end_at) return [start];
  const end = bkkDateStr(item.end_at);
  if (end <= start) return [start];
  const days: string[] = [];
  const cursor = new Date(`${start}T00:00:00+07:00`);
  const last = new Date(`${end}T00:00:00+07:00`);
  // Cap the span so a stray multi-year end date can't build a huge array.
  for (let i = 0; i <= 366 && cursor <= last; i += 1) {
    days.push(bkkDateStr(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export function CalendarMonth({
  items,
  selectedDate,
  onSelectDate,
}: {
  items: Item[];
  selectedDate: string;
  onSelectDate: (day: string) => void;
}) {
  const today = bkkDateStr();
  // The visible month tracks the selected day but can be paged independently.
  const [cursor, setCursor] = useState(() => {
    const [y, m] = selectedDate.split('-').map(Number);
    return { year: y, month: m - 1 };
  });

  // day 'YYYY-MM-DD' → how many items land on it. Drives the busy dots.
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) {
      for (const day of itemDays(item)) {
        map.set(day, (map.get(day) ?? 0) + 1);
      }
    }
    return map;
  }, [items]);

  const { year, month } = cursor;
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  // Fixed 6-row grid (42 cells) so paging months doesn't jump the layout.
  const cells: Array<string | null> = [];
  for (let i = 0; i < firstWeekday; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(ymd(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  while (cells.length < 42) cells.push(null);

  const step = (delta: number) => {
    const next = new Date(Date.UTC(year, month + delta, 1));
    setCursor({ year: next.getUTCFullYear(), month: next.getUTCMonth() });
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Previous month"
          accessibilityRole="button"
          hitSlop={10}
          onPress={() => step(-1)}
          style={styles.navBtn}
        >
          <Ionicons name="chevron-back" size={20} color={colors.primary} />
        </Pressable>
        <Text style={styles.monthLabel}>
          {MONTHS[month]} {year}
        </Text>
        <Pressable
          accessibilityLabel="Next month"
          accessibilityRole="button"
          hitSlop={10}
          onPress={() => step(1)}
          style={styles.navBtn}
        >
          <Ionicons name="chevron-forward" size={20} color={colors.primary} />
        </Pressable>
      </View>

      <View style={styles.weekRow}>
        {WEEKDAYS.map((label, index) => (
          <Text key={index} style={styles.weekday}>
            {label}
          </Text>
        ))}
      </View>

      <View style={styles.grid}>
        {cells.map((day, index) => {
          if (!day) return <View key={`empty-${index}`} style={styles.cell} />;
          const count = counts.get(day) ?? 0;
          const isToday = day === today;
          const isSelected = day === selectedDate;
          const dayNum = Number(day.slice(-2));
          return (
            <Pressable
              key={day}
              accessibilityLabel={`${day}${count ? `, ${count} items` : ''}`}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              onPress={() => onSelectDate(day)}
              style={styles.cell}
            >
              <View
                style={[
                  styles.dayInner,
                  isToday && styles.dayToday,
                  isSelected && styles.daySelected,
                ]}
              >
                <Text
                  style={[
                    styles.dayText,
                    isToday && styles.dayTextToday,
                    isSelected && styles.dayTextSelected,
                  ]}
                >
                  {dayNum}
                </Text>
              </View>
              <View style={styles.dotSlot}>
                {count > 0 && (
                  <View style={[styles.dot, isSelected && styles.dotSelected]} />
                )}
              </View>
            </Pressable>
          );
        })}
      </View>

      {(year !== Number(today.slice(0, 4)) || month !== Number(today.slice(5, 7)) - 1) && (
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => {
            const [y, m] = today.split('-').map(Number);
            setCursor({ year: y, month: m - 1 });
            onSelectDate(today);
          }}
          style={styles.todayBtn}
        >
          <Ionicons name="today-outline" size={14} color={colors.primary} />
          <Text style={styles.todayBtnText}>Today</Text>
        </Pressable>
      )}
    </View>
  );
}

const CELL = `${100 / 7}%`;

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  navBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  monthLabel: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  weekRow: {
    flexDirection: 'row',
    marginBottom: spacing.xs,
  },
  weekday: {
    width: CELL,
    textAlign: 'center',
    color: colors.textFaint,
    fontSize: font.xs,
    fontWeight: '700',
    letterSpacing: 1,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    width: CELL,
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  dayInner: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  dayToday: {
    borderWidth: 1,
    borderColor: colors.borderBright,
  },
  daySelected: {
    backgroundColor: colors.primary,
  },
  dayText: {
    color: colors.text,
    fontSize: font.sm,
    fontWeight: '600',
  },
  dayTextToday: {
    color: colors.primary,
  },
  dayTextSelected: {
    color: colors.onPrimary,
    fontWeight: '800',
  },
  dotSlot: {
    height: 8,
    justifyContent: 'center',
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  dotSelected: {
    backgroundColor: colors.primaryBright,
  },
  todayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },
  todayBtnText: {
    color: colors.primary,
    fontSize: font.xs,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
