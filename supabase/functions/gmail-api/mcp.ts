import { Client } from 'npm:@modelcontextprotocol/sdk@1.30.0/client/index.js';
import { StreamableHTTPClientTransport } from 'npm:@modelcontextprotocol/sdk@1.30.0/client/streamableHttp.js';
export const GMAIL_MCP_URL = 'https://gmailmcp.googleapis.com/mcp/v1';
const readTools = new Set(['search_threads', 'get_thread', 'list_labels', 'list_drafts']);
export function isGmailReadTool(name: string): boolean {
  return readTools.has(name.replace(/^gmail\./, ''));
}
/** Google OAuth credential is used only with Google's fixed resource endpoint. */
export async function gmailMcp(token: string, call?: { name: string; arguments: Record<string, unknown> }) {
  if (call && !isGmailReadTool(call.name)) throw new Error('Gmail tool is not allowed');
  const client = new Client({ name: 'vora-gmail', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(GMAIL_MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${token}` }, redirect: 'error' },
    fetch: (url: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).href !== GMAIL_MCP_URL) throw new Error('Unexpected Gmail endpoint');
      return fetch(url, { ...init, redirect: 'error', signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(20000)]) });
    },
  });
  try {
    await client.connect(transport);
    const tools: Array<{ name: string; description?: string; inputSchema: Record<string, unknown> }> = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const result = await client.listTools(cursor ? { cursor } : {});
      tools.push(...result.tools.filter((tool: {name: string}) => isGmailReadTool(tool.name)).map((tool: {name: string; description?: string; inputSchema: Record<string, unknown>}) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })));
      cursor = result.nextCursor;
      if (!cursor) {
        if (!call) return { tools };
        if (!tools.some(tool => tool.name === call.name)) throw new Error('Gmail tool is unavailable');
        const result = await client.callTool(call);
        if (result.isError) throw new Error('Gmail read failed');
        return { result };
      }
    }
    throw new Error('Too many tool pages');
  } finally { await client.close(); }
}

export async function listGmailTools(token: string) { return (await gmailMcp(token)).tools ?? []; }
