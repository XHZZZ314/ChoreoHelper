// B2 选择稳定性：真实 UI 模块、历史函数与隔离 DOM；浏览器另验。
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const base=fs.readFileSync(path.join(__dirname,'test-b1-feedback.js'),'utf8').split('let passed=0,failed=0;')[0];
const sandbox={require,__dirname,process,console,setTimeout,clearTimeout,setInterval,clearInterval};
vm.createContext(sandbox);
vm.runInContext(base.replace("process.env.B1_SOURCE&&['choreo-workbench.js','choreo-stage-motion-ui.js'].includes(n)?path.join(process.env.B1_SOURCE,n)","process.env.B2_SOURCE&&['choreo-workbench.js','choreo-stage-motion-ui.js'].includes(n)?path.join(process.env.B2_SOURCE,n)")+ ';globalThis.makeFixture=fixture;globalThis.flatten=flat;',sandbox);
let pass=0,fail=0;
function test(n,fn){try{fn();pass++;console.log('PASS '+n)}catch(e){fail++;console.log('FAIL '+n+'\n'+e.stack)}}
function fixture(n=4){const f=sandbox.makeFixture(n);for(const name of ['choreo-ability-plan.js','choreo-skill-metadata.js','choreo-ability-plan-targets.js','choreo-ability-ui.js'])vm.runInContext(fs.readFileSync(path.join(name==='choreo-ability-ui.js'&&process.env.B2_SOURCE||__dirname,name),'utf8'),f.ctx);return f}
const skill={id:120,type:'action',name:'测试技能',staticMetadata:{version:1,actionId:120,castMs:0,recastMs:2500,requiredLevel:1,maxCharges:0,range:25,effectRange:0}};
for(const count of [4,8])test('TD-02 global selection and deletion target '+count,()=>{
 const f=fixture(count),a=f.ctx.ChoreoAbilityUI,p=f.ctx.ChoreoAbilityPlan;
 for(let di=0;di<count;di++)assert.equal(a.quickAdd(skill,di,2).ok,true);
 const ids=p.rows(f.store).map(r=>r.event.id);a.setSel(ids[0]);a.toggleSel(ids[count-1]);
 for(let di=0;di<count;di++)a.lane(di);
 assert.deepEqual(Array.from(a.selection()),[ids[0],ids[count-1]]);
 a.setSel(ids[0]);for(let di=0;di<count;di++)a.lane(di);
 const b=sandbox.flatten(a.renderContext()).find(n=>n.id==='wbSkillDel');assert.ok(b);b.onclick();
 assert.deepEqual(p.rows(f.store).map(r=>r.event.id).join(','),ids.slice(1).join(','));
});
test('TD-02 begin motion keeps foreign object selections',()=>{const f=fixture();f.ctx.ChoreoAbilityUI.quickAdd(skill,0,2);const id=f.ctx.ChoreoAbilityPlan.rows(f.store)[0].event.id;f.ctx.ChoreoAbilityUI.setSel(id);const c=f.clip();c.selected=true;f.UI.selectMotion(2);assert.equal(c.selected,true);assert.equal(f.ctx.ChoreoAbilityUI.selection()[0],id)});
test('HF-07 overlapping paths prefer current then cycle all',()=>{const f=fixture();for(let i=0;i<4;i++)f.setPath([[5,5,0]],i);f.store.selectedDancer=2;const seen=[];for(let i=0;i<5;i++){assert.equal(f.UI.pickTopPath(3,0,.2),true);seen.push(f.UI.sessionState().di)}assert.deepEqual(seen,[2,0,1,3,2])});
test('HF-07 marker beats crossing line and markers cycle',()=>{const f=fixture();f.store.currentTime=0;f.store.selectedDancer=2;for(let i=0;i<4;i++)f.setPath([[5,5,0]],i);const w=f.workbench();w.drawTop();const t=w.topViewTransform();const seen=[];for(let i=0;i<5;i++){f.ctx.__topClick({clientX:t.w/2,clientY:t.h/2});seen.push(f.store.selectedDancer)}assert.deepEqual(seen,[2,0,1,3,2]);assert.equal(f.UI.sessionActive(),false)});
test('HF-07 marker cycling without extra tracks and external selection reset',()=>{const f=fixture();delete f.store.contentExtra._doc.extraTracks;f.store.selectedDancer=2;const w=f.workbench();w.drawTop();const t=w.topViewTransform(),click=()=>f.ctx.__topClick({clientX:t.w/2,clientY:t.h/2});click();assert.equal(f.store.selectedDancer,2);click();assert.equal(f.store.selectedDancer,0);f.store.selectedDancer=3;click();assert.equal(f.store.selectedDancer,3)});
test('TD-05 movement facing and add button have separate vertical hit bands',()=>{const f=fixture();f.M.install(f.store,f.M.edit(f.store,0,{movement:[{time:'5',x:'3',z:'0'}],facing:[{time:'5',yaw:'90'}]},'two'));const lane=f.UI.lane(0),buttons=sandbox.flatten(lane).filter(n=>n.className==='stage-motion-clip'||n.className==='btn stage-motion-open');const bands=buttons.map(n=>{const s=n.style.cssText;const top=Number((/top:(\d+)px/.exec(s)||[])[1]);const h=Number((/height:(\d+)px/.exec(s)||[])[1]);assert.ok(Number.isFinite(top)&&Number.isFinite(h));return [top,top+h]});for(let i=0;i<bands.length;i++)for(let j=i+1;j<bands.length;j++)assert.ok(bands[i][1]<=bands[j][0]||bands[j][1]<=bands[i][0])});
test('history real undo redo retains affected dancer and type highlight',()=>{
 const f=fixture(),w=f.workbench();f.store.history=[];f.store.historyIdx=-1;f.ctx.persistProject=()=>{};f.ctx.bumpTimelineRev=()=>{};
 const app=fs.readFileSync(path.join(__dirname,'choreo-app.js'),'utf8');
 for(const [start,end] of [['function saveHistory(){','// === WP-3'],['function undo(){','// Emote categorization']])vm.runInContext(app.slice(app.indexOf(start),app.indexOf(end,app.indexOf(start))),f.ctx);
 f.ctx.render=()=>w.syncStage();f.ctx.saveHistory();w.syncStage();f.setPath([[5,5,0]],2);f.ctx.saveHistory();w.syncStage();f.store.selectedDancer=0;f.ctx.undo();assert.equal(f.store.selectedDancer,2);assert.match(f.find('wbHistorySelection').textContent,/走位.*Synthetic 3|Synthetic 3.*走位/);f.ctx.redo();assert.equal(f.store.selectedDancer,2);assert.match(f.find('wbHistorySelection').textContent,/走位/);
});
console.log(pass+' passed, '+fail+' failed');process.exitCode=fail?1:0;
