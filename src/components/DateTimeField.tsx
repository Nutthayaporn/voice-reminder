import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';

import { colors, font, radius, spacing } from '../theme';
import {
  initialBangkokValue,
  pickerDate,
  updateBangkokPart,
  type DateTimePart,
} from './dateTimeFieldValue';

const TIME_ZONE = 'Asia/Bangkok';

export function DateTimeField({
  value,
  allDay,
  onChange,
}: {
  value: string | null;
  allDay: boolean;
  onChange: (value: string | null) => void;
}) {
  const current = pickerDate(value);

  const update = (part: DateTimePart, selected: Date) => {
    onChange(updateBangkokPart(value, selected, part, allDay));
  };

  const openAndroidPicker = (part: DateTimePart) => {
    DateTimePickerAndroid.open({
      value: current,
      mode: part,
      is24Hour: true,
      timeZoneName: TIME_ZONE,
      onValueChange: (_event, selected) => update(part, selected),
    });
  };

  if (!value) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          if (Platform.OS === 'android') {
            openAndroidPicker('date');
          } else {
            onChange(initialBangkokValue(allDay));
          }
        }}
        style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
      >
        <Text style={styles.addText}>+ Add {allDay ? 'date' : 'date and time'}</Text>
      </Pressable>
    );
  }

  if (Platform.OS === 'android') {
    return (
      <View style={styles.wrapper}>
        <View style={styles.row}>
          <PickerButton label={formatDate(current)} onPress={() => openAndroidPicker('date')} />
          {!allDay && (
            <PickerButton label={formatTime(current)} onPress={() => openAndroidPicker('time')} />
          )}
        </View>
        <ClearButton onPress={() => onChange(null)} />
      </View>
    );
  }

  return (
    <View style={styles.wrapper}>
      <View style={styles.iosRow}>
        <DateTimePicker
          accentColor={colors.primary}
          display="compact"
          locale="en-GB"
          mode="date"
          onValueChange={(_event, selected) => update('date', selected)}
          themeVariant="dark"
          timeZoneName={TIME_ZONE}
          value={current}
        />
        {!allDay && (
          <DateTimePicker
            accentColor={colors.primary}
            display="compact"
            locale="en-GB"
            mode="time"
            onValueChange={(_event, selected) => update('time', selected)}
            themeVariant="dark"
            timeZoneName={TIME_ZONE}
            value={current}
          />
        )}
      </View>
      <ClearButton onPress={() => onChange(null)} />
    </View>
  );
}

function PickerButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.pickerButton, pressed && styles.pressed]}
    >
      <Text style={styles.pickerText}>{label}</Text>
    </Pressable>
  );
}

function ClearButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" hitSlop={8} onPress={onPress}>
      <Text style={styles.clearText}>Clear date</Text>
    </Pressable>
  );
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(value);
}

function formatTime(value: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(value);
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  iosRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pickerButton: {
    minHeight: 48,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  pickerText: { color: colors.text, fontSize: font.md },
  addButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  addText: { color: colors.primary, fontSize: font.sm, fontWeight: '700' },
  clearText: { alignSelf: 'flex-start', color: colors.textFaint, fontSize: font.xs },
  pressed: { opacity: 0.7 },
});
