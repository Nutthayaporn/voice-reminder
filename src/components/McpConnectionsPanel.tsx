import { GmailConnectionCard } from './GmailConnectionCard';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, radius, spacing } from '../theme';
import { isBudgetApiConfigured } from '../config';
import { getAccessToken } from '../integrations/budgetOAuth';
import { discoverBudgetMcp } from '../integrations/budgetMcp';
import { loadBudgetMcpForSettings, mcpProviders, saveBudgetMcp, validateBudgetEndpoint } from '../integrations/mcp/connections';

export type McpConnectionId = 'budget' | 'gmail';

/** Second-level menu: one row per MCP connection, drilling into its detail. */
export function McpConnectionMenu({ budgetConnected, onSelect }: { budgetConnected: boolean; onSelect: (id: McpConnectionId) => void }) {
  const rows: Array<{ id: McpConnectionId; icon: keyof typeof Ionicons.glyphMap; label: string; sub: string }> = [
    { id: 'budget', icon: 'wallet-outline', label: 'Daily Budget', sub: budgetConnected ? 'เชื่อมบัญชีแล้ว' : 'บันทึกค่าใช้จ่ายด้วยเสียง' },
    { id: 'gmail', icon: 'mail-outline', label: 'Gmail', sub: 'อ่านอีเมลผ่าน MCP · Preview' },
  ];
  return (
    <View style={styles.menuGroup}>
      {rows.map((row, index) => (
        <View key={row.id}>
          {index > 0 && <View style={styles.menuSep} />}
          <Pressable
            accessibilityRole="button"
            onPress={() => onSelect(row.id)}
            style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}
          >
            <View style={styles.menuIcon}>
              <Ionicons name={row.icon} size={18} color={colors.primary} />
            </View>
            <View style={styles.menuCopy}>
              <Text style={styles.menuLabel}>{row.label}</Text>
              <Text style={styles.menuSub} numberOfLines={1}>{row.sub}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
          </Pressable>
        </View>
      ))}
    </View>
  );
}

interface Props { connected: boolean; busy: boolean; onConnect: () => Promise<void>; onDisconnect: () => Promise<void>; only?: McpConnectionId }
export function McpConnectionsPanel({ connected, busy, onConnect, onDisconnect, only }: Props) {
  const [endpoint, setEndpoint] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [savedEnabled, setSavedEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const [tools, setTools] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    loadBudgetMcpForSettings().then(value => { if (active) { setEndpoint(value.endpoint); setEnabled(value.enabled); setSavedEnabled(value.enabled); if (value.notice) setMessage(value.notice); } })
      .catch(() => { if (active) setMessage('โหลดการตั้งค่าไม่สำเร็จ กรุณาบันทึกใหม่'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => { setTools([]); }, [connected]);
  const disabled = loading || working || busy;
  const run = async (task: () => Promise<void>) => {
    setWorking(true); setMessage('');
    try { await task(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'เชื่อมต่อไม่สำเร็จ'); }
    finally { setWorking(false); }
  };
  const verify = async () => {
    const url = validateBudgetEndpoint(endpoint);
    const token = await getAccessToken();
    if (!token) throw new Error('กรุณาเชื่อมบัญชี Daily Budget ใหม่ก่อนทดสอบ');
    const found = await discoverBudgetMcp(url, token);
    if (!found.some(tool => tool.name === 'get_budget_summary')) throw new Error('เซิร์ฟเวอร์ไม่มีเครื่องมือ Daily Budget ที่ VORA ต้องใช้');
    setTools(found.map(tool => tool.name));
    return url;
  };
  return <View style={styles.page}>
    {only !== 'gmail' && mcpProviders.map(provider => <View key={provider.id} style={styles.card}>
      <Text style={styles.title}>{provider.name}</Text>
      <Text style={styles.hint}>{provider.description}</Text>
      <Text style={styles.status}>{connected ? 'เชื่อมบัญชีแล้ว' : 'ยังไม่เชื่อมบัญชี'} · {savedEnabled ? 'ตั้งค่าใช้ MCP' : 'ใช้การเชื่อมต่อเดิม'}</Text>
      {!isBudgetApiConfigured() && <Text style={styles.hint}>ผู้ดูแลต้องตั้งค่า Daily Budget API ก่อนเริ่มเชื่อมต่อ</Text>}
      <Pressable accessibilityRole="button" disabled={disabled || !isBudgetApiConfigured()}
        style={[styles.button, (disabled || !isBudgetApiConfigured()) && styles.disabled]}
        onPress={() => void run(connected ? onDisconnect : onConnect)}>
        <Text style={styles.buttonText}>{connected ? 'ยกเลิกการเชื่อมบัญชี' : 'เชื่อมบัญชี Daily Budget'}</Text>
      </Pressable>
      <Text style={styles.label}>MCP Server URL</Text>
      <TextInput accessibilityLabel="Daily Budget MCP Server URL" value={endpoint} editable={!disabled}
        onChangeText={value => { setEndpoint(value); setTools([]); setMessage(''); }} autoCapitalize="none" autoCorrect={false}
        placeholder="https://your-project.supabase.co/functions/v1/budget-mcp" placeholderTextColor={colors.textFaint} style={styles.input} />
      <Text style={styles.hint}>ใช้เซิร์ฟเวอร์ของ Daily Budget ที่เชื่อมกับแอปนี้ ไม่ต้องใส่ API key</Text>
      <View style={styles.row}><Text style={styles.label}>ใช้ MCP กับคำสั่งเสียง</Text>
        <Switch accessibilityLabel="ใช้ Daily Budget MCP กับคำสั่งเสียง" value={enabled} disabled={disabled}
          onValueChange={setEnabled} trackColor={{ true: colors.primaryDark }} />
      </View>
      <Pressable accessibilityRole="button" disabled={disabled || !connected} style={[styles.button, (disabled || !connected) && styles.disabled]}
        onPress={() => void run(async () => { setTools([]); await verify(); setMessage('ทดสอบสำเร็จ ยังไม่ได้เปลี่ยนการตั้งค่า'); })}>
        <Text style={styles.buttonText}>ทดสอบการเชื่อมต่อ</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={disabled || !isBudgetApiConfigured()} style={[styles.button, (disabled || !isBudgetApiConfigured()) && styles.disabled]}
        onPress={() => void run(async () => {
          const url = enabled ? await verify() : validateBudgetEndpoint(endpoint);
          await saveBudgetMcp({ endpoint: url, enabled });
          setSavedEnabled(enabled);
          setMessage(enabled ? 'บันทึกแล้ว คำสั่งงบประมาณจะเรียกผ่าน MCP' : 'บันทึกแล้ว กลับไปใช้การเชื่อมต่อเดิม');
        })}><Text style={styles.buttonText}>บันทึกการตั้งค่า</Text></Pressable>
      {tools.length > 0 && <View><Text style={styles.label}>เครื่องมือที่บัญชีนี้ใช้ได้ ({tools.length})</Text>
        {tools.map(name => <Text key={name} style={styles.hint}>• {name}</Text>)}
      </View>}
    </View>)}
    {only !== 'budget' && <GmailConnectionCard />}
    {only !== 'gmail' && disabled && <ActivityIndicator color={colors.primary} />}
    {only !== 'gmail' && !!message && <Text accessibilityLiveRegion="polite" style={styles.hint}>{message}</Text>}
  </View>;
}
const styles = StyleSheet.create({
  page: { gap: 16 }, card: { padding: 18, gap: 14, borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  title: { color: colors.text, fontSize: 20, fontWeight: '700' }, label: { color: colors.text, fontSize: 15 },
  hint: { color: colors.textMute, fontSize: 14, lineHeight: 22 }, status: { color: colors.primary, fontSize: 14 },
  input: { color: colors.text, borderWidth: 1, borderColor: colors.borderBright, borderRadius: radius.md, padding: 12, fontSize: 14 },
  button: { padding: 14, alignItems: 'center', borderRadius: radius.md, backgroundColor: colors.primarySoft },
  buttonText: { color: colors.primaryBright, fontWeight: '600' }, disabled: { opacity: 0.4 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  menuGroup: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, overflow: 'hidden' },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 60, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  menuRowPressed: { backgroundColor: colors.cardRaised },
  menuIcon: { width: 34, height: 34, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  menuCopy: { flex: 1, minWidth: 0, gap: 2 },
  menuLabel: { color: colors.text, fontSize: font.md, fontWeight: '600' },
  menuSub: { color: colors.textMute, fontSize: font.xs, lineHeight: 16 },
  menuSep: { height: 1, backgroundColor: colors.border, marginLeft: 64 },
});
