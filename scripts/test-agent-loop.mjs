import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const mod = {exports:{}};
new Function('module','exports',ts.transpileModule(fs.readFileSync('src/brain/toolLoop.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(mod,mod.exports);
const {runToolLoop}=mod.exports;
const call=(id,name,args)=>({role:'assistant',tool_calls:[{id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});
let step=0, reads=0;
const tools=[{name:'gmail_search',description:'search',parameters:{},execute:async()=>{reads++;return {id:'thread1'};}},{name:'gmail_read',description:'read',parameters:{},execute:async args=>{assert.equal(args.id,'thread1');reads++;return {appointment:'2026-09-20T10:00:00+07:00'};}}];
const result=await runToolLoop([{role:'user',content:'Find appointment and remind me'}],tools,async history=>{
 if(step++===0)return call('1','gmail_search',{});
 if(step===2){assert.equal(JSON.parse(history.at(-1).content).untrusted_data.id,'thread1');return call('2','gmail_read',{id:'thread1'});}
 assert.equal(JSON.parse(history.at(-1).content).untrusted_data.appointment,'2026-09-20T10:00:00+07:00');
 return {role:'assistant',content:JSON.stringify({actions:[{tool:'create_reminder',title:'Appointment'}]})};
},()=>{});
assert.equal(reads,2);assert.deepEqual(result.usedTools,['gmail_search','gmail_read']);
await assert.rejects(()=>runToolLoop([],tools,async()=>call('bad','gmail_send',{}),()=>{}),/Invalid tool/);
let changed=false;
await assert.rejects(()=>runToolLoop([],[{...tools[0],execute:async()=>{changed=true;return {};}}],async()=>call('1','gmail_search',{}),()=>{if(changed)throw Error('account changed');}),/account changed/);
let failures=0;
await assert.rejects(()=>runToolLoop([],[{...tools[0],execute:async()=>{failures++;throw Error('upstream failure');}}],async()=>call('1','gmail_search',{}),()=>{}),/upstream failure/);
assert.equal(failures,1);
let rounds=0;
await assert.rejects(()=>runToolLoop([],tools,async()=>call(String(++rounds),'gmail_search',{}),()=>{}),/limit/);
assert.equal(rounds,7);
await assert.rejects(()=>runToolLoop([],[{...tools[0],execute:async()=>({text:'x'.repeat(49000)})}],async()=>call('1','gmail_search',{}),()=>{}),/too large/);
console.log('Agent loop: search → read → plan, account changes, tool allowlist, bounded rounds/results and no retries passed.');
