// 网页主流程回归：草稿取消/提交/校验/单次撤销边界，不冒充浏览器旅程。
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert/strict');
const base=process.env.CHOREO_FLOW_SOURCE||__dirname;
function setup(conflict=(s,d)=>s<3||s+d>12){
 const nodes=[];
 class Node{constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.style={};this.value='';this.isConnected=true;nodes.push(this)}appendChild(n){this.children.push(n);n.parentNode=this;return n}setAttribute(k,v){this[k]=v}focus(){this.focused=true}blur(){if(this.onchange)this.onchange()}get textContent(){return (this.text||'')+this.children.map(n=>n.textContent).join('')}set textContent(v){this.text=String(v);this.children=[]}}
 const document={createElement:t=>new Node(t),getElementById:id=>nodes.find(n=>n.id===id)};
 const ctx={document,window:{},console};ctx.window=ctx;vm.createContext(ctx);
 for(const n of ['choreo-clip-time.js','choreo-props-ui.js'])vm.runInContext(fs.readFileSync(path.join(base,n),'utf8'),ctx);
 const clip={id:2,start:4,duration:3,autoDur:true,data:{name:'合成拍手'}},prev={start:0,duration:3},next={start:12,duration:2};let commits=0;
 const bar=ctx.ChoreoPropsUI.renderContextBar({selection:[{clip,di:1,track:'action'}],dancerName:'合成舞者乙',neighbors:()=>({prev,next}),totalDuration:()=>30,conflict,commit:()=>commits++});
 return {clip,bar,get:id=>document.getElementById(id),input(id,v){const n=this.get(id);n.value=v;n.oninput&&n.oninput()},get commits(){return commits}};
}
const checks=[];function test(name,run){try{run();checks.push({name,ok:true});console.log('PASS '+name)}catch(e){checks.push({name,ok:false});console.log('FAIL '+name+': '+e.message)}}
test('blur never commits wait',()=>{const t=setup();t.input('wbCtxWait','2');t.get('wbCtxWait').blur();assert.equal(t.clip.start,4);assert.equal(t.commits,0)});
test('selected dancer is explicit',()=>assert.match(setup().bar.textContent,/合成舞者乙/));
test('wait and duration draft cancel is zero mutation',()=>{const t=setup();t.input('wbCtxWait','2');t.input('wbCtxDurEdit','4');t.get('wbCtxTimeCancel').onclick();assert.equal(t.clip.start,4);assert.equal(t.clip.duration,3);assert.equal(t.get('wbCtxWait').value,'1');assert.equal(t.get('wbCtxDurEdit').value,'3');assert.equal(t.commits,0)});
test('combined apply commits once and preserves identity',()=>{const t=setup();t.input('wbCtxWait','2');t.input('wbCtxDurEdit','4');t.get('wbCtxTimeApply').onclick();assert.equal(t.clip.start,5);assert.equal(t.clip.duration,4);assert.equal(t.clip.autoDur,false);assert.equal(t.clip.id,2);assert.equal(t.commits,1);t.get('wbCtxTimeApply').onclick();assert.equal(t.commits,1)});
test('invalid wait is rejected without clamping or mutation',()=>{for(const v of ['','-1','1e309','Infinity']){const t=setup();t.input('wbCtxWait',v);t.get('wbCtxTimeApply').onclick();assert.equal(t.clip.start,4);assert.equal(t.commits,0);assert.ok(t.get('wbCtxTimeError').textContent)}});
test('conflict rejection leaves both time fields intact',()=>{const t=setup();t.input('wbCtxWait','8');t.input('wbCtxDurEdit','4');t.get('wbCtxTimeApply').onclick();assert.equal(t.clip.start,4);assert.equal(t.clip.duration,3);assert.equal(t.commits,0);assert.match(t.get('wbCtxTimeError').textContent,/冲突/)});
test('stale draft cannot commit',()=>{const t=setup();t.input('wbCtxWait','2');t.clip.start=6;t.get('wbCtxTimeApply').onclick();assert.equal(t.clip.start,6);assert.equal(t.commits,0);assert.match(t.get('wbCtxTimeError').textContent,/变化/)});
test('Enter applies and Escape cancels with no extra commit',()=>{const t=setup(),e=k=>({key:k,preventDefault(){},stopPropagation(){}});t.input('wbCtxDurEdit','4');t.get('wbCtxDurEdit').onkeydown(e('Escape'));assert.equal(t.get('wbCtxDurEdit').value,'3');t.input('wbCtxDurEdit','4');t.get('wbCtxDurEdit').onkeydown(e('Enter'));assert.equal(t.clip.duration,4);assert.equal(t.commits,1)});
test('no-op Apply creates no history',()=>{const t=setup();t.get('wbCtxTimeApply').onclick();assert.equal(t.commits,0)});
test('precise start may reorder before the original previous clip',()=>{const t=setup(()=>false);t.input('wbCtxStartEdit','0');t.input('wbCtxDurEdit','1');t.get('wbCtxTimeApply').onclick();assert.equal(t.clip.start,0);assert.equal(t.clip.duration,1);assert.equal(t.commits,1)});
if(process.env.CHOREO_FLOW_RESULTS)fs.writeFileSync(process.env.CHOREO_FLOW_RESULTS,JSON.stringify(checks,null,2));
process.exitCode=checks.some(c=>!c.ok)?1:0;
