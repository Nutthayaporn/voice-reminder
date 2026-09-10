import AsyncStorage from '@react-native-async-storage/async-storage';
import { config } from '../../config';

/** Provider adapters own credentials; the connection registry stores no tokens. */
export const mcpProviders = [{ id: 'daily-budget', name: 'Daily Budget', description: 'ถามยอดงบและจัดการรายรับรายจ่ายด้วยเสียง' }] as const;
export type McpProviderId = typeof mcpProviders[number]['id'];
export interface McpConnection { endpoint: string; enabled: boolean }
const key = 'vora_mcp_connections_v1';

export function defaultBudgetMcpEndpoint(): string {
  if (!config.budgetApi.url.trim()) return '';
  const api = new URL(config.budgetApi.url.trim());
  if (!/\/functions\/v1\/budget-api\/?$/.test(api.pathname) || api.search || api.hash || api.username || api.password) {
    throw new Error('EXPO_PUBLIC_BUDGET_API_URL ต้องลงท้ายด้วย /functions/v1/budget-api');
  }
  api.pathname = api.pathname.replace(/\/budget-api\/?$/, '/budget-mcp');
  return api.href;
}

export function validateBudgetEndpoint(endpoint: string): string {
  const url = new URL(endpoint.trim());
  const expected = new URL(defaultBudgetMcpEndpoint());
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('กรุณาใช้ HTTPS');
  if (url.origin !== expected.origin || url.pathname !== expected.pathname || url.search || url.hash || url.username || url.password) throw new Error('URL ต้องเป็น budget-mcp ในโปรเจกต์เดียวกับ Daily Budget ที่แอปตั้งไว้');
  return url.href;
}
export async function loadBudgetMcp(): Promise<McpConnection> {
  const raw = await AsyncStorage.getItem(key);
  if (raw) {
    const saved = JSON.parse(raw)['daily-budget'];
    if (saved && typeof saved.endpoint === 'string' && typeof saved.enabled === 'boolean') return saved;
    throw new Error('การตั้งค่า MCP ไม่ถูกต้อง กรุณาบันทึกใหม่');
  }
  return { endpoint: config.budgetApi.mcpUrl || defaultBudgetMcpEndpoint(), enabled: !!config.budgetApi.mcpUrl };
}

/** Repair the editable draft only. Runtime must reject stale destinations until saved. */
export async function loadBudgetMcpForSettings(): Promise<McpConnection & { notice?: string }> {
  const connection = await loadBudgetMcp();
  if (!connection.endpoint && !config.budgetApi.url.trim()) return connection;
  try {
    return { ...connection, endpoint: validateBudgetEndpoint(connection.endpoint) };
  } catch {
    return { endpoint: defaultBudgetMcpEndpoint(), enabled: false,
      notice: 'URL เดิมไม่ตรงกับ Daily Budget ปัจจุบัน เติม URL ใหม่ให้แล้ว กรุณาทดสอบ เปิด MCP และบันทึกอีกครั้ง' };
  }
}
export async function saveBudgetMcp(connection: McpConnection): Promise<void> {
  const endpoint = validateBudgetEndpoint(connection.endpoint);
  await AsyncStorage.setItem(key, JSON.stringify({ 'daily-budget': { endpoint, enabled: connection.enabled } }));
}
export async function budgetMcpEndpoint(): Promise<string | null> {
  const connection = await loadBudgetMcp();
  return connection.enabled ? validateBudgetEndpoint(connection.endpoint) : null;
}
