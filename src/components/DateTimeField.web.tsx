import { createElement, type ChangeEvent, type CSSProperties } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, font, spacing } from '../theme';
import {
  dateInputValue,
  timeInputValue,
  updateWebDate,
  updateWebTime,
} from './dateTimeFieldValue';

const inputStyle: CSSProperties = {
  minWidth: 0,
  minHeight: 48,
  flex: 1,
  boxSizing: 'border-box',
  color: colors.text,
  colorScheme: 'dark',
  backgroundColor: colors.bgAlt,
  border: `1px solid ${colors.border}`,
  borderRadius: 10,
  padding: `0 ${spacing.md}px`,
  fontSize: font.md,
};

export function DateTimeField({
  value,
  allDay,
  onChange,
}: {
  value: string | null;
  allDay: boolean;
  onChange: (value: string | null) => void;
}) {
  return (
    <View style={styles.wrapper}>
      <View style={styles.row}>
        {createElement('input', {
          'aria-label': 'Date',
          onChange: (event: ChangeEvent<HTMLInputElement>) => {
            onChange(updateWebDate(value, event.currentTarget.value, allDay));
          },
          style: inputStyle,
          type: 'date',
          value: dateInputValue(value),
        })}
        {!allDay && createElement('input', {
          'aria-label': 'Time',
          onChange: (event: ChangeEvent<HTMLInputElement>) => {
            onChange(updateWebTime(value, event.currentTarget.value));
          },
          style: inputStyle,
          type: 'time',
          value: timeInputValue(value),
        })}
      </View>
      {value && (
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => onChange(null)}>
          <Text style={styles.clearText}>Clear date</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  clearText: { alignSelf: 'flex-start', color: colors.textFaint, fontSize: font.xs },
});
