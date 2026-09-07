import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';
const env = {
  SUPABASE_URL: 'https://test-project.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-service',
  GOOGLE_CALENDAR_CLIENT_ID: 'google-client', GOOGLE_CALENDAR_CLIENT_SECRET: 'google-secret',
  MICROSOFT_CALENDAR_CLIENT_ID: 'ms-client', MICROSOFT_CALENDAR_CLIENT_SECRET: 'ms-secret',
  CALENDAR_TOKEN_KEY: Buffer.alloc(32,7).toString('base64'), CALENDAR_RETURN_URLS: 'https://vora.example/,voicereminder://calendar/callback',
};
const records = { calendar_connections: [], calendar_oauth_states: [] };
const calls = [];
let handler, poisonedPage = false;
const db = {
  auth: { getUser: async token => ({ data: { user: token === 'valid-jwt' ? { id: 'owner-a' } : null }, error: null }) },
  from(table) {
    const filters = [], query = { op:'select', data:null, single:false };
    const builder = {
      select() { return builder; }, delete() { query.op='delete'; return builder; }, insert(data) { query.op='insert'; query.data=data; return builder; },
      update(data) { query.op='update'; query.data=data; return builder; },
      eq(k,v) { filters.push(row => row[k] === v); calls.push(['eq',table,k,v]); return builder; },
      gt(k,v) { filters.push(row => row[k] > v); return builder; },
      or() { filters.push(() => false); return builder; },
      maybeSingle() { query.single=true; return builder; },
      then(resolve,reject) {
        try {
          const matching = records[table].filter(row => filters.every(fn => fn(row)));
          if (query.op === 'insert') records[table].push(query.data);
          if (query.op === 'delete') records[table] = records[table].filter(row => !matching.includes(row));
          if (query.op === 'update') matching.forEach(row => Object.assign(row,query.data));
          return Promise.resolve({ data: query.single ? matching[0] ?? null : matching, error:null }).then(resolve,reject);
        } catch(e) { return Promise.reject(e).then(resolve,reject); }
      },
    };
    return builder;
  },
  async rpc(name,args) {
    assert.equal(name,'complete_calendar_oauth');
    const state = records.calendar_oauth_states.find(s => s.state_hash === args.p_state_hash);
    if (!state) return { data:false,error:null };
    records.calendar_oauth_states = records.calendar_oauth_states.filter(s => s !== state);
    records.calendar_connections.push({ user_id:state.user_id,provider:state.provider,tokens:args.p_tokens });
    return { data:true,error:null };
  },
};
const modelModule = { exports:{} };
const transpile = file => ts.transpileModule(fs.readFileSync(file,'utf8'), { compilerOptions:{ target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS } }).outputText;
new Function('module','exports',transpile('src/integrations/calendar/model.ts'))(modelModule,modelModule.exports);
const fetchMock = async (url, init) => {
  calls.push(['fetch',String(url)]);
  if (String(url).includes('/token')) {
    assert.equal(init.body.get('client_secret'),'google-secret');
    assert.ok(init.body.get('code_verifier'));
    return Response.json({ access_token:'private-access-token',refresh_token:'private-refresh-token',expires_in:3600 });
  }
  assert.ok(String(url).startsWith('https://www.googleapis.com/'), 'never send bearer tokens to a foreign host');
  if (String(url).includes('calendarList')) return Response.json({ items:[{id:'c',summary:'Calendar'}] });
  return Response.json({ items:[], ...(poisonedPage ? { nextPageToken:'next' } : {}) });
};
new Function('Deno','require','module','exports','fetch','crypto',transpile('supabase/functions/calendar-api/index.ts'))(
  { env:{ get:name => env[name] },serve:fn => { handler=fn; } },
  name => name.startsWith('npm:') ? { createClient:() => db } : modelModule.exports,
  { exports:{} },{},fetchMock,webcrypto,
);
const post = (body,token='valid-jwt') => handler(new Request('https://test-project.supabase.co/functions/v1/calendar-api', { method:'POST',headers:{'Content-Type':'application/json',...(token ? { Authorization:`Bearer ${token}` } : {})},body:JSON.stringify(body) }));
assert.equal((await post({action:'status'},null)).status,401);
assert.equal((await post({action:'status'},'bad-jwt')).status,401);
const status = await (await post({action:'status'})).json();
assert.equal(status.connections.length,2);
assert.ok(calls.some(c => c[0]==='eq' && c[1]==='calendar_connections' && c[2]==='user_id' && c[3]==='owner-a'));
assert.equal((await post({action:'connect',provider:'google',returnUrl:'https://attacker.example/'})).status,400);
const connection = await (await post({action:'connect',provider:'google',returnUrl:'https://vora.example/'})).json();
const auth = new URL(connection.url);
assert.equal(auth.origin,'https://accounts.google.com');
assert.equal(auth.searchParams.get('scope'),'https://www.googleapis.com/auth/calendar.readonly');
assert.equal(auth.searchParams.get('code_challenge_method'),'S256');
assert.notEqual(records.calendar_oauth_states[0].state_hash,auth.searchParams.get('state'),'raw state is not persisted');
const callback = `https://test-project.supabase.co/functions/v1/calendar-api?state=${auth.searchParams.get('state')}&code=test-code`;
const response = await handler(new Request(callback));
assert.equal(response.status,303);
assert.equal(response.headers.get('Location'),'https://vora.example/?calendar_result=connected');
assert.ok(!records.calendar_connections[0].tokens.includes('private-'),'stored tokens must be encrypted');
assert.equal((await handler(new Request(callback))).status,400,'state replay must fail');
const events = await post({action:'events',provider:'google',calendarIds:['c'],start:'2026-09-07',end:'2026-09-08'});
assert.equal(events.status,200,'encrypted tokens decrypt for the bound owner/provider');
assert.equal((await post({action:'events',provider:'google',calendarIds:['foreign'],start:'2026-09-07',end:'2026-09-08'})).status,400);
poisonedPage = true;
const oversized = await post({action:'events',provider:'google',calendarIds:['c'],start:'2026-09-07',end:'2026-09-08'});
assert.equal(oversized.status,400,'bounded pagination must reject incomplete results');
assert.ok(!(await oversized.text()).includes('private-access-token'));
assert.equal((await post({action:'disconnect',provider:'google'})).status,200);
assert.equal(records.calendar_connections.length,0);
assert.equal(records.calendar_oauth_states.length,0);
console.log('Calendar API checks passed: JWT, owner filters, allowlist, PKCE, single-use state, encrypted tokens, token-free callback, calendar authorization, bounded pagination, and disconnect. Database calls use an in-memory adapter.');
