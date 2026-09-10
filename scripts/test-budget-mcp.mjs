import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const mod={exports:{}};
new Function('module','exports',ts.transpileModule(fs.readFileSync('src/integrations/budgetMcp.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(mod,mod.exports);
const {callBudgetMcp}=mod.exports;
const calls=[];
const request=async(url,init)=>{
 const body=JSON.parse(init.body);calls.push({url,init,body});
 if(url.endsWith('/mcp-token')) {assert.equal(init.headers.Authorization,'Bearer rest-user-token');return Response.json({access_token:'mcp-scoped-token'});}
 assert.equal(init.headers.Authorization,'Bearer mcp-scoped-token');
 if(body.method==='notifications/initialized')return new Response(null,{status:202});
 return Response.json({jsonrpc:'2.0',id:body.id,result:body.method==='initialize'?{protocolVersion:'2025-11-25',capabilities:{tools:{}}}:{structuredContent:{summary:{remaining:100}}}});
};
const result=await callBudgetMcp('https://example.com/functions/v1/budget-mcp','rest-user-token',{action:'summary',month:'2026-09'},request);
assert.equal(result.summary.remaining,100);
assert.deepEqual(calls.map(c=>c.body.method||'exchange'),['exchange','initialize','notifications/initialized','tools/call']);
assert.deepEqual(calls.at(-1).body.params,{name:'get_budget_summary',arguments:{month:'2026-09'}});
let writes=0;
await assert.rejects(()=>callBudgetMcp('https://example.com/functions/v1/budget-mcp','rest-user-token',{action:'add_expense',amount:10},async(url,init)=>{
 const b=JSON.parse(init.body);if(b.method==='tools/call'){writes++;throw Error('connection lost after write');}return request(url,init);
}));assert.equal(writes,1,'must never retry an uncertain write');
await assert.rejects(()=>callBudgetMcp('http://example.com/budget-mcp','token',{},request));
console.log('VORA MCP: token separation, handshake, tool mapping, HTTPS checks and no write retries passed.');
let failedCalls=0;
await assert.rejects(()=>callBudgetMcp('https://example.com/functions/v1/budget-mcp','rest-user-token',{action:'summary'},async()=>{
 failedCalls++; return Response.json({error:'invalid_target'},{status:400});
}),/budget_mcp_token_exchange 400 invalid_target/);
assert.equal(failedCalls,1,'do not retry or initialize after failed exchange');
await assert.rejects(()=>callBudgetMcp('https://example.com/functions/v1/budget-mcp','rest-user-token',{action:'summary'},async()=>Response.json({error:'private-token-value'},{status:400})),error=>error.message.includes('unknown_error')&&!error.message.includes('private-token-value'));
console.log('Token exchange diagnostics: known errors surfaced, unknown bodies hidden, no retries passed.');
