import { useState } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { capabilities, type CapabilityOptions } from '../help/capabilities';
import { colors, spacing, radius } from '../theme';

export function CapabilityGuide({ options, onSpeak, onExample, disabled = false }: { options: CapabilityOptions; onSpeak: () => void; onExample: (text: string) => void; disabled?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const entries = capabilities(options);
  return <View style={styles.box}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={styles.row}>
      <Text style={styles.title}>VORA ทำอะไรได้บ้าง {expanded ? '▴' : '▾'}</Text>
    </Pressable>
    {expanded && <View>
      <Pressable accessibilityRole="button" disabled={disabled} onPress={onSpeak} style={styles.row}><Text style={styles.title}>ฟังคำแนะนำ 🔊</Text></Pressable>
      {entries.map((entry) => <View key={entry.id} style={styles.row}>
        <Text style={styles.title}>{entry.title}</Text>
        <Text style={styles.copy}>{entry.description}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`ฟังตัวอย่าง ${entry.example}`} disabled={disabled} onPress={() => onExample(entry.example)}><Text style={styles.hint}>ลองพูด: “{entry.example}” 🔊</Text></Pressable>
      </View>)}
    </View>}
  </View>;
}
const styles = StyleSheet.create({
  box: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  row: { padding: spacing.md, minHeight: 44, gap: spacing.sm },
  title: { color: colors.text, fontWeight: '600', fontSize: 14 },
  copy: { color: colors.textMute, fontSize: 14, lineHeight: 21 },
  hint: { color: colors.textMute, paddingHorizontal: spacing.md, paddingBottom: spacing.md, lineHeight: 21 },
});
