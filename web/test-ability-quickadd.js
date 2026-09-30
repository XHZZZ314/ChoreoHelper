// TASK-20260918-PLAYER-UX-SIMPLIFY B1：技能默认落条回归——quickDefaults 纯默认值、
// quickAdd 单舞者落条（一次撤销）、quickAddAll 全舞者整批一次撤销、缺目录基础时间回落编辑窗不静默。
'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
function element(tag){return {tag,children:[],style:{},value:'',textContent:'',type:'',className:'',checked:false,readOnly:false,disabled:false,hidden:false,
  setAttribute(k,v){this[k]=v},appendChild(n){this.children.push(n);n.parentNode=this;return n},remove(){this.removed=true},
  append(...ns){ns.forEach(n=>this.appendChild(n))},replaceChildren(){this.children=[]},focus(){},select(){},click(){}}}
const toasts=[],history=[],renders=[];
const store={projectId:'q',currentTime:7,selectedDancer:0,gameConnected:false,
  dancers:[{id:7,name:'甲',actionClips:[],switchClips:[],lyricClips:[],profileId:''},{id:2,name:'乙',actionClips:[],switchClips:[],lyricClips:[],profileId:''}],
  contentExtra:{_doc:{performerIds:{7:'native-a',2:'native-b'},extraTracks:[]}}};
const metadataOk={version:1,actionId:120,castMs:1500,recastMs:2500,requiredLevel:1,maxCharges:0,range:25,effectRange:0};
let metadataSource=metadataOk;
const ctx={store,document:{body:element('body'),createElement:element,createTextNode:t=>element('')},crypto:require('crypto').webcrypto,
  setTimeout,clearTimeout,setInterval,clearInterval,
  updateTotalDuration(){},saveHistory(){history.push(1)},render(){renders.push(1)},
  showToast(m){toasts.push(m)},apiFetch:async()=>({schemaVersion:1,context:{available:false},skill:null})};
ctx.window=ctx;vm.createContext(ctx);
for(const f of ['choreo-ability-plan.js','choreo-skill-metadata.js','choreo-ability-plan-targets.js','choreo-ability-ui.js'])
  vm.runInContext(fs.readFileSync(__dirname+'/'+f,'utf8'),ctx);
const P=ctx.ChoreoAbilityPlan,UI=ctx.ChoreoAbilityUI,skill={id:120,type:'action',name:'治疗',duration:1.5,
  staticMetadata:{version:1,actionId:120,castMs:1500,recastMs:2500,requiredLevel:1,maxCharges:0,range:25,effectRange:0}};
function descendants(node){return node.children.flatMap(n=>[n,...descendants(n)])}
function verifyMissingEditor(){
  const editors=ctx.document.body.children.filter(n=>n.id==='wbSkillEditor'&&!n.removed);
  assert.equal(editors.length,1,'真实编辑节点挂载且只有一份');
  const nodes=descendants(editors[0]),cast=nodes.find(n=>n['aria-label']==='咏唱提示时长（秒）');
  assert.ok(cast);assert.equal(cast.readOnly,true);assert.equal(cast.value,'');
  const before=JSON.stringify(store.contentExtra),count=history.length;
  cast.value='0'; // 即使修改 DOM 值也不能伪造未提供的基础时间。
  nodes.find(n=>n.tag==='button'&&n.textContent==='应用技能编排').onclick();
  assert.equal(JSON.stringify(store.contentExtra),before);assert.equal(history.length,count);
  assert.ok(nodes.some(n=>n.role==='status'&&/缺少技能基础时间/.test(n.textContent)));
  nodes.find(n=>n.tag==='button'&&n.textContent==='取消').onclick();
  assert.equal(JSON.stringify(store.contentExtra),before);assert.equal(history.length,count);
  assert.equal(editors[0].removed,true);
}
let n=0;const test=(name,fn)=>{fn();n++;console.log('PASS '+name)};
test('quickDefaults：无基础值/非技能不可默认；有效目录出完整默认值（含 0 秒咏唱）',()=>{
  assert.equal(P.quickDefaults(skill,null),null);
  assert.equal(P.quickDefaults({type:'emote',id:1},metadataOk),null);
  const v=P.quickDefaults(skill,metadataOk);
  assert.deepEqual({...v,start:'2.5'},{start:'2.5',cast:'1.5',presentation:'1',targetKind:'defaultSelf',targetPerformer:'',targetLabel:'',targetX:'0',targetY:'0',targetZ:'0'});
  const z=P.quickDefaults({...skill,staticMetadata:{...skill.staticMetadata,castMs:0}},{...metadataOk,castMs:0});
  assert.equal(z.cast,'0');
});
test('quickAdd：默认落条（defaultSelf/目录咏唱/表现1s/落点时刻）且一次 saveHistory',()=>{
  const r=UI.quickAdd(skill,0,2.5);
  assert.equal(r.ok,true);
  const rows=P.rows(store);assert.equal(rows.length,1);
  const p=P.plan(rows[0].event);
  assert.equal(p.target.kind,'defaultSelf');assert.equal(p.castMs,1500);assert.equal(p.presentationMs,1000);
  assert.equal(rows[0].event.startMs,2500);assert.equal(rows[0].event.durationMs,2500);
  assert.equal(store.dancers[0].actionClips.length,0); // 不写普通动作轨
  assert.equal(history.length,1);assert.equal(renders.length,1);
  assert.match(toasts[0],/撤销/);
});
test('quickAdd：缺目录基础时间→明示 toast+回落编辑窗，零写入',()=>{
  toasts.length=0;const before=P.rows(store).length;
  const r=UI.quickAdd({...skill,id:121,staticMetadata:undefined},0,1);
  assert.equal(r.ok,false);assert.equal(r.missing,'cast');
  assert.match(toasts[0],/无法按默认落条/);verifyMissingEditor();
  assert.equal(P.rows(store).length,before);
});
test('quickAddAll：两位舞者整批落条一次 saveHistory；缺基础值整批不动回落编辑窗',()=>{
  history.length=0;
  const original=P.rows(store)[0].event,originalText=JSON.stringify(original);
  const r=UI.quickAddAll(skill,3);
  assert.equal(r.ok,true);assert.equal(r.count,2);
  const rows=P.rows(store);assert.equal(rows.length,3);
  assert.equal(rows.filter(x=>x.source==='native-a').length,2); // 首轮 quickAdd 1 条 + 整批 1 条
  assert.equal(rows.filter(x=>x.source==='native-b').length,1);
  assert.equal(JSON.stringify(rows.find(x=>x.event.id===original.id).event),originalText,'原有技能条完整保留');
  const added=rows.filter(x=>x.event.id!==original.id);assert.equal(added.length,2);
  added.forEach(x=>assert.equal(x.event.startMs,3000));
  assert.equal(history.length,1);
  toasts.length=0;const before=P.rows(store).length;
  const bad=UI.quickAddAll({...skill,id:122,staticMetadata:undefined},4);
  assert.equal(bad.ok,false);assert.equal(bad.missing,'cast');
  assert.equal(P.rows(store).length,before);assert.match(toasts[0],/无法按默认落条/);verifyMissingEditor();
});
// 2026-09-25 属主决定：只保护已锁内容，允许另建技能轨继续添加。
test('quickAdd：锁定轨道保持原样，另建未锁轨道添加',()=>{
  toasts.length=0;
  const locked=JSON.parse(JSON.stringify(P.tracks(store)));
  locked.filter(t=>t.type==='ability').forEach(t=>t.locked=true);
  store.contentExtra._doc.extraTracks=locked;
  const frozen=JSON.stringify(locked),count=history.length;
  const before=P.rows(store).length;
  const r=UI.quickAdd({...skill,id:123,staticMetadata:{...skill.staticMetadata,actionId:123}},0,5);
  assert.equal(r.ok,true);assert.equal(P.rows(store).length,before+1);assert.equal(history.length,count+1);
  assert.equal(JSON.stringify(P.tracks(store).filter(t=>t.locked)),frozen);
  const added=P.tracks(store).filter(t=>!t.locked);assert.equal(added.length,1);assert.equal(added[0].events.length,1);
});
test('quickAdd：真实轨道ID冲突→toast 明示且文档/历史零半写',()=>{
  toasts.length=0;
  const locked=JSON.parse(JSON.stringify(P.tracks(store)));
  locked.forEach(t=>t.locked=true);locked[0].id='ability-track-collision';
  store.contentExtra._doc.extraTracks=locked;
  const before=P.rows(store).length,text=JSON.stringify(store.contentExtra),count=history.length,originalCrypto=ctx.crypto;
  ctx.crypto={randomUUID:()=> 'collision'};
  let r;try{r=UI.quickAdd({...skill,id:124,staticMetadata:{...skill.staticMetadata,actionId:124}},0,6)}finally{ctx.crypto=originalCrypto}
  assert.equal(r.ok,false);assert.equal(r.missing,'error');
  assert.equal(P.rows(store).length,before);assert.match(toasts[0],/未写入/);
  assert.match(toasts[0],/轨道 ID 冲突/);assert.equal(JSON.stringify(store.contentExtra),text);assert.equal(history.length,count);
});
test('quickAdd：非真实Action身份整批拒绝且文档/历史零写入',()=>{
  const text=JSON.stringify(store.contentExtra),count=history.length;
  for(const type of ['emote',undefined]){
    const r=UI.quickAdd({...skill,type},0,7);
    assert.equal(r.ok,false);assert.equal(r.missing,'identity');
    assert.equal(JSON.stringify(store.contentExtra),text);assert.equal(history.length,count);
  }
});
console.log('ability quick-add passed ('+n+' tests)');
UI.clearSelection();
