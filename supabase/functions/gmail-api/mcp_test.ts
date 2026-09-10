import { GMAIL_MCP_URL, isGmailReadTool, listGmailTools } from './mcp.ts';
function assert(value: unknown, message = 'Assertion failed'): asserts value { if (!value) throw new Error(message); }
Deno.test('official MCP SDK initializes, paginates and hides write tools', async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url, init) => {
    assert(String(url) === GMAIL_MCP_URL);
    assert(new Headers(init?.headers).get('authorization') === 'Bearer test-google-token');
    assert(init?.redirect === 'error');
    if (init?.method === 'GET') return new Response(null, { status: 405 });
    const body = JSON.parse(String(init?.body)); calls.push(body.method);
    if (body.id === undefined) return new Response(null, { status: 202 });
    let result: unknown;
    if (body.method === 'initialize') result = { protocolVersion: body.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'test', version: '1' } };
    else {
      assert(body.method === 'tools/list');
      result = body.params?.cursor ? { tools: [{ name: 'gmail.get_thread', inputSchema: { type: 'object' } }] }
        : { tools: [{ name: 'gmail.search_threads', inputSchema: { type: 'object' } }, { name: 'gmail.create_draft', inputSchema: { type: 'object' } }], nextCursor: 'page2' };
    }
    return Response.json({ jsonrpc: '2.0', id: body.id, result });
  }) as typeof fetch;
  try {
    const result = await listGmailTools('test-google-token');
    assert(result.map(t => t.name).join(',') === 'gmail.search_threads,gmail.get_thread');
    assert(calls.includes('initialize') && calls.filter(c => c === 'tools/list').length === 2);
    assert(!isGmailReadTool('gmail.send') && !isGmailReadTool('evil.search_threads'));
  } finally { globalThis.fetch = original; }
});
Deno.test('Gmail read calls use discovered names; write calls never reach Google', async () => {
  const { gmailMcp } = await import('./mcp.ts');
  const original = globalThis.fetch;
  let count = 0;
  globalThis.fetch = (async (_url, init) => {
    count++;
    if (init?.method === 'GET') return new Response(null, {status:405});
    const body = JSON.parse(String(init?.body));
    if (body.id === undefined) return new Response(null, {status:202});
    const result = body.method === 'initialize' ? {protocolVersion:body.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'test',version:'1'}}
      : body.method === 'tools/list' ? {tools:[{name:'gmail.get_thread',inputSchema:{type:'object'}}]}
      : {content:[{type:'text',text:'appointment fixture'}]};
    if (body.method === 'tools/call') assert(body.params.name === 'gmail.get_thread' && body.params.arguments.id === 'fixture');
    return Response.json({jsonrpc:'2.0',id:body.id,result});
  }) as typeof fetch;
  try {
    try { await gmailMcp('test', {name:'gmail.create_draft',arguments:{}}); throw new Error('unexpected success'); }
    catch (e) { assert(String(e).includes('not allowed')); }
    assert(count === 0);
    const result = await gmailMcp('test', {name:'gmail.get_thread',arguments:{id:'fixture'}});
    assert(JSON.stringify(result.result).includes('appointment fixture'));
  } finally { globalThis.fetch = original; }
});
