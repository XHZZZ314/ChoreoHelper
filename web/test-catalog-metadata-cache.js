// 离线旧目录恢复回归：只补可信同版缺失基础值，保存事务及未知缓存内容不受影响。
'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');
const source=process.env.CHOREO_CATALOG_SOURCE||__dirname;
const ctx={AbortController,Map,Set,Number,Promise,setTimeout,clearTimeout};ctx.window=ctx;vm.createContext(ctx);
for(const name of ['choreo-skill-metadata.js','choreo-catalog.js'])vm.runInContext(fs.readFileSync(path.join(name==='choreo-catalog.js'?source:__dirname,name),'utf8'),ctx);
const copy=x=>JSON.parse(JSON.stringify(x));
const row={id:1,type:'action',name:'技能',jobId:25,jobName:'职业',staticMetadata:{version:1,actionId:1,castMs:2500,recastMs:2500,requiredLevel:1,maxCharges:0,range:25,effectRange:0}};
const bundled={gameVersion:'2026.09.15.0000.0000',emotes:[{id:1}],actions:[row],races:[],classJobs:[]};
async function restore(cache,fallback=bundled,existing={actions:[row]}){let applied=null,saves=0;const c=ctx.ChoreoCatalog.create({load:async()=>cache,save:async()=>{saves++},apply:x=>{applied=x},fallback:()=>fallback});const g=c.begin();const changed=await c.restore(g,existing);return {applied,saves,changed,c,g};}
const cache=()=>{const c=copy(bundled);delete c.actions[0].staticMetadata;c.actions[0].opaque={preserve:1};c.custom='keep';return c};
(async()=>{let passed=0,failed=0;async function test(n,fn){try{await fn();passed++;console.log('PASS '+n)}catch(e){failed++;console.error('FAIL '+n+': '+e.message)}}
await test('same-version cache completes missing metadata in memory without writing original',async()=>{const c=cache(),before=copy(c),r=await restore(c);assert.equal(r.applied.actions[0].staticMetadata.castMs,2500);assert.deepEqual(c,before);assert.deepEqual(r.applied.actions[0].opaque,{preserve:1});assert.equal(r.applied.custom,'keep');assert.equal(r.saves,0);assert.equal(await r.c.restore(r.g,{actions:[row]}),false)});
await test('foreign and unknown game versions never borrow bundled values',async()=>{for(const v of [undefined,'2026.09.15','2026.09.16.0000.0000']){const c=cache();c.gameVersion=v;assert.equal((await restore(c)).applied.actions[0].staticMetadata,undefined)}});
await test('name/job/identity mismatches stay unresolved',async()=>{for(const key of ['id','type','name','jobId','jobName']){const c=cache();c.actions[0][key]=typeof c.actions[0][key]==='number'?2:'changed';if(key==='type'){await assert.rejects(()=>restore(c));continue}assert.equal((await restore(c)).applied.actions[0].staticMetadata,undefined)}});
await test('matching incomplete identities cannot borrow metadata',async()=>{for(const [key,value] of [['name',undefined],['name',' '],['jobName',''],['jobId',undefined],['jobId',-1],['jobId','25']]){const c=cache(),f=copy(bundled);c.actions[0][key]=value;f.actions[0][key]=value;assert.equal((await restore(c,f)).applied.actions[0].staticMetadata,undefined)}});
await test('matching incomplete version strings are still unknown',async()=>{for(const value of ['2026.09.15','invalid']){const c=cache(),f=copy(bundled);c.gameVersion=value;f.gameVersion=value;assert.equal((await restore(c,f)).applied.actions[0].staticMetadata,undefined)}});
await test('existing valid, invalid or explicitly null metadata is not overwritten',async()=>{for(const value of [{...row.staticMetadata,castMs:1000},{version:2},null]){const c=cache();c.actions[0].staticMetadata=value;assert.deepEqual((await restore(c)).applied.actions[0].staticMetadata,value)}});
await test('invalid or duplicate fallback cannot break valid cached catalog',async()=>{for(const f of [null,{...bundled,actions:[row,row]},{...bundled,emotes:[]}]){assert.equal((await restore(cache(),f)).applied.actions[0].staticMetadata,undefined)}});
await test('stale restore cancelled before load completes never applies or saves',async()=>{let release,applies=0;const c=ctx.ChoreoCatalog.create({load:()=>new Promise(r=>release=r),fallback:()=>bundled,apply:()=>applies++});const g=c.begin(),pending=c.restore(g,{actions:[row]});c.cancel();release(cache());assert.equal(await pending,false);assert.equal(applies,0)});
console.log(JSON.stringify({passed,failed}));if(failed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});
