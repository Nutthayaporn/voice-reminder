import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius } from '../theme';
import { useStore } from '../store/useStore';
import { connectGmail, gmailApi, type GmailStatus } from '../integrations/mcp/gmail';
export function GmailConnectionCard() {
  const owner = useStore(state => state.userId);
  const generation = useRef(0);
  const [status, setStatus] = useState<GmailStatus>({ ready: false, connected: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [tools, setTools] = useState<Array<{ name: string }>>([]);
  const refresh = async (version: number) => {
    const result = await gmailApi<{ connections: GmailStatus[] }>({ action: 'status' });
    if (version === generation.current) setStatus(result.connections[0] ?? { ready: false, connected: false });
  };
  useEffect(() => {
    const version = ++generation.current;
    setTools([]); setStatus({ ready: false, connected: false }); setMessage(''); setBusy(!!owner);
    if (owner) void refresh(version).catch(() => { if (version === generation.current) setMessage('ยังติดต่อบริการ Gmail ไม่ได้ กรุณาตรวจการตั้งค่าเซิร์ฟเวอร์'); }).finally(() => { if (version === generation.current) setBusy(false); });
    if (Platform.OS === 'web') {
      const url = new URL(window.location.href), result = url.searchParams.get('gmail_result');
      if (result) { setMessage(result === 'connected' ? 'อนุญาตบัญชีแล้ว กดทดสอบ MCP เพื่อยืนยันการใช้งาน' : 'Google ยังเชื่อมไม่สำเร็จ กรุณาลองใหม่'); url.searchParams.delete('gmail_result'); window.history.replaceState(null, '', url.href); }
    }
    return () => { generation.current++; };
  }, [owner]);
  const run = async (task: (version: number) => Promise<void>) => {
    const version = generation.current; setBusy(true); setMessage('');
    try { await task(version); }
    catch (error) { if (version === generation.current) setMessage(error instanceof Error ? error.message : 'เชื่อมต่อไม่สำเร็จ'); }
    finally { if (version === generation.current) setBusy(false); }
  };
  return <View style={styles.card}>
    <Text style={styles.title}>Gmail</Text>
    <Text style={styles.hint}>เชื่อม Google เพื่อเข้าถึง Gmail MCP ด้วยสิทธิ์อ่านอีเมล</Text>
    <Text style={styles.status}>{!owner ? 'กรุณาเข้าสู่ระบบ VORA ก่อน' : !status.ready ? 'รอตั้งค่าเซิร์ฟเวอร์' : status.connected ? 'อนุญาตบัญชีแล้ว' : 'ยังไม่เชื่อมบัญชี'}</Text>
    <Pressable accessibilityRole="button" disabled={busy || !owner || (!status.ready && !status.connected)}
      style={[styles.button, (busy || !owner || (!status.ready && !status.connected)) && styles.disabled]}
      onPress={() => void run(async version => {
        if (status.connected) await gmailApi({ action: 'disconnect' }); else await connectGmail();
        if (version === generation.current) setTools([]);
        await refresh(version);
      })}><Text style={styles.buttonText}>{status.connected ? 'ยกเลิกการเชื่อม Gmail' : 'เชื่อมบัญชี Google'}</Text></Pressable>
    <Text style={styles.hint}>เซิร์ฟเวอร์ทางการของ Google · Developer Preview</Text>
    <Text selectable style={styles.hint}>https://gmailmcp.googleapis.com/mcp/v1</Text>
    <Pressable accessibilityRole="button" disabled={busy || !owner || !status.connected} style={[styles.button, (busy || !owner || !status.connected) && styles.disabled]}
      onPress={() => void run(async version => {
        setTools([]);
        const result = await gmailApi<{ tools: Array<{ name: string }> }>({ action: 'tools' });
        if (version === generation.current) { setTools(result.tools); setMessage(result.tools.length ? 'เชื่อม MCP สำเร็จ พบเครื่องมืออ่านข้อมูล' : 'เชื่อม MCP ได้ แต่ยังไม่พบเครื่องมืออ่านที่ VORA รองรับ'); }
      })}><Text style={styles.buttonText}>ทดสอบ Gmail MCP</Text></Pressable>
    {busy && <ActivityIndicator color={colors.primary} />}
    {tools.map(tool => <Text key={tool.name} style={styles.hint}>• {tool.name}</Text>)}
    {!!message && <Text accessibilityLiveRegion="polite" style={styles.hint}>{message}</Text>}
    <Text style={styles.hint}>ถามด้วยเสียงเพื่อค้นหรืออ่านอีเมลได้ ข้อมูลที่เรียกอ่านจะส่งให้ AI ของ VORA ประมวลผล การยกเลิกจะลบการเชื่อมใน VORA; เพิกถอนสิทธิ์ Google เพิ่มเติมได้ในบัญชี Google</Text>
  </View>;
}
const styles = StyleSheet.create({
  card: { padding: 18, gap: 14, borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  title: { color: colors.text, fontSize: 20, fontWeight: '700' }, hint: { color: colors.textMute, fontSize: 14, lineHeight: 22 },
  status: { color: colors.primary, fontSize: 14 }, button: { padding: 14, alignItems: 'center', borderRadius: radius.md, backgroundColor: colors.primarySoft },
  buttonText: { color: colors.primaryBright, fontWeight: '600' }, disabled: { opacity: 0.4 },
});
