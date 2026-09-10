/** Stateless Streamable HTTP client for our MCP server; no automatic write retries. */
const TOOLS: Record<string,string> = {summary:'get_budget_summary',list:'list_expenses',add_expense:'add_expense',update_expense:'update_expense',delete_expense:'delete_expense'};
async function requestBudgetMcp<T>(endpoint: string, restToken: string, payload: Record<string,unknown> | null, request: typeof fetch = fetch): Promise<T> {
  const url=new URL(endpoint);
  if(url.protocol!=='https:' && !['localhost','127.0.0.1'].includes(url.hostname)) throw new Error('budget_mcp_requires_https');
  if(url.search || url.hash || url.username || url.password || !url.pathname.endsWith('/budget-mcp')) throw new Error('invalid_budget_mcp_url');
  const tokenUrl=new URL(url.href);tokenUrl.pathname=tokenUrl.pathname.replace(/\/budget-mcp$/,'/mcp-token');
  const exchange=await request(tokenUrl.href,{method:'POST',headers:{Authorization:`Bearer ${restToken}`,'Content-Type':'application/json'},body:JSON.stringify({resource:url.href}),signal:AbortSignal.timeout(30000),redirect:'error'});
  if(!exchange.ok) {
    const body=await exchange.json().catch(()=>null);
    // Only display known error codes; never surface arbitrary response bodies or credentials.
    const code=['invalid_target','invalid_token','invalid_scope','method_not_allowed'].includes(body?.error) ? body.error : 'unknown_error';
    const hint=code==='invalid_target' ? ' — MCP URL ไม่ตรงกับ resource ของเซิร์ฟเวอร์ Daily Budget' : '';
    throw new Error(`budget_mcp_token_exchange ${exchange.status} ${code}${hint}`);
  }
  const credential=await exchange.json();if(typeof credential.access_token!=='string') throw new Error('invalid_mcp_token_response');
  let sequence=0;
  const rpc=async (method:string,params:Record<string,unknown>,notification=false) => {
    const id=++sequence;
    const response=await request(url.href,{method:'POST',headers:{Authorization:`Bearer ${credential.access_token}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25'},body:JSON.stringify({jsonrpc:'2.0',...(notification?{}:{id}),method,params}),signal:AbortSignal.timeout(30000),redirect:'error'});
    if(!response.ok) throw new Error(`budget_mcp_http ${response.status}`);
    if(notification) return;
    const message=await response.json();
    if(message.jsonrpc!=='2.0'||message.id!==id||message.error||!message.result) throw new Error('budget_mcp_protocol_error');
    return message.result;
  };
  const name=payload ? TOOLS[String(payload.action)] : null;
  if(payload && !name) throw new Error('unknown_budget_tool');
  const init=await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'vora',version:'1.0.0'}});
  if(init.protocolVersion!=='2025-11-25'||!init.capabilities?.tools) throw new Error('unsupported_budget_mcp_server');
  await rpc('notifications/initialized',{},true);
  if (!payload) {
    const listed = await rpc('tools/list', {});
    if (!Array.isArray(listed.tools) || listed.tools.some((tool: {name?: unknown}) => typeof tool?.name !== 'string')) throw new Error('invalid_mcp_tools');
    return listed.tools as T;
  }
  const {action:_,...args}=payload;
  const result=await rpc('tools/call',{name,arguments:args});
  if(result.isError) throw new Error('budget_mcp_tool_error');
  const data=result.structuredContent;
  if(!data || typeof data!=='object' || data.error) throw new Error('invalid_budget_mcp_result');
  return data as T;
}

export function callBudgetMcp<T>(endpoint: string, restToken: string, payload: Record<string, unknown>, request: typeof fetch = fetch): Promise<T> {
  return requestBudgetMcp<T>(endpoint, restToken, payload, request);
}
export function discoverBudgetMcp(endpoint: string, restToken: string): Promise<Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>> {
  return requestBudgetMcp(endpoint, restToken, null);
}
