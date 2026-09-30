// 空时间轴引导与底栏计数回归：技能和原生事件不是空项目；空轨容器不算条目。
'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
require('./choreo-edit.js');
require('./choreo-document.js');
require('./choreo-docwire.js');
require('./choreo-ability-plan.js');
const stage=require('./choreo-stage-motion.js');
const source=fs.readFileSync(process.env.CHOREO_EMPTY_APP||__dirname+'/choreo-app.js','utf8');
// OVERHAUL 批 C 第六步迁移：projectIsEmpty 与尾标记 '// ===== P1-A' 都随 RENDER 外壳搬到
// choreo-app-render.js——该切片改读拆分件；renderBottomBar 仍在主件（⑱ 保留区）不动。
// CHOREO_EMPTY_APP 指旧目录时仍读旧 choreo-app.js 两标记切片，对拍红测语义不变。
const renderSource=process.env.CHOREO_EMPTY_APP?source:fs.readFileSync(__dirname+'/choreo-app-render.js','utf8');
const start=renderSource.indexOf('function projectIsEmpty(){'),end=renderSource.indexOf('// ===== P1-A',start);
assert.ok(start>=0&&end>start,'production projectIsEmpty source must be found');
const ctx={ChoreoEdit:globalThis.ChoreoEdit};
vm.runInNewContext(renderSource.slice(start,end),ctx);
const bottom=source.indexOf('function renderBottomBar(){');
assert.ok(bottom>=0,'production renderBottomBar source must be found');
ctx.el=()=>({});ctx.gameActorIdx=()=>-1;
vm.runInNewContext(source.slice(bottom),ctx);
const ability=globalThis.ChoreoAbilityPlan,wire=globalThis.ChoreoDocWire;
let passed=0,failed=0;
function test(name,fn){try{fn();passed++;console.log('PASS '+name)}catch(e){failed++;console.error('FAIL '+name+'\n'+e.stack)}}
function empty(){return {dancers:[{id:0,name:'舞者 1',switchClips:[],actionClips:[],lyricClips:[]}],globalLyrics:[],markers:[],contentExtra:{}}}
function check(state,expected){const before=JSON.stringify(state);ctx.store=state;assert.equal(ctx.projectIsEmpty(),expected);assert.equal(JSON.stringify(state),before,'empty-state read must not mutate content')}
function count(state,expected,extra){const before=JSON.stringify(state);ctx.store=state;const html=ctx.renderBottomBar().innerHTML;
  const found=html.match(/条目: <span class="v">(\d+)<\/span>/);assert.ok(found,'rendered item count must exist');assert.equal(Number(found[1]),expected);
  if(extra!==undefined)assert.ok(html.includes('额外轨道事件 '+extra),'tooltip must expose the extra event count');
  assert.equal(JSON.stringify(state),before,'count render must not mutate content');
}
function install(state,tracks){state.contentExtra._doc={extraTracks:tracks}}
function native(kind){return {id:'tr-'+kind,type:kind,performerId:'actor-0',enabled:true,events:[{id:'ev-'+kind,kind,startMs:0,durationMs:1000,enabled:true,data:{}}]}}
function fromDoc(doc){const p=wire.loadProjection(doc).proj;return {...p,contentExtra:wire.unknownTopKeys(p)}}
function roundtrip(state){const p={dancers:state.dancers,globalLyrics:state.globalLyrics,markers:state.markers,...state.contentExtra};return fromDoc(wire.persistDoc(p,{id:'empty-check',name:'空状态回归'},1))}
test('fresh project and optional document carrier absence stay empty',()=>{
  const s=empty();check(s,true);delete s.contentExtra;check(s,true);
});
test('empty native tracks and document metadata alone stay empty',()=>{
  const s=empty();install(s,['ability','movement','facing','cue','motion','lyrics'].map(k=>({...native(k),events:[]})));
  s.contentExtra._doc.metadata={notes:'not timeline content'};check(s,true);check(roundtrip(s),true);
});
for(const lane of ['switchClips','actionClips','lyricClips'])test(lane+' content still hides empty guidance',()=>{
  const s=empty();s.dancers[0][lane].push({id:1,start:0,duration:1,data:{name:'原有内容'}});check(s,false);
});
test('global lyrics and section markers still hide empty guidance',()=>{
  const s=empty();s.globalLyrics.push({id:1,start:0,duration:1,data:{name:'歌词'}});check(s,false);
  s.globalLyrics=[];s.markers.push({id:'m',t:0,name:'开头'});check(s,false);
});
test('real ability constructors create nonempty skill-only content, including reopen',()=>{
  const s=empty();
  const e=ability.make({id:31,type:'action',name:'重劈'},{start:'0',cast:'0',presentation:'1',targetKind:'defaultSelf'},'skill');
  const all=ability.upsert([],'actor-0',e,'ability-track',ability.performers(s));
  install(s,all);check(s,false);check(roundtrip(s),false);
});
for(const kind of ['movement','facing'])test('real '+kind+' constructor creates nonempty content, including reopen',()=>{
  const s=empty(),nodes={movement:[],facing:[]};
  nodes[kind]=kind==='movement'?[{time:'2',x:'1',z:'0'}]:[{time:'2',yaw:'90'}];
  stage.install(s,stage.edit(s,0,nodes,'path'));check(s,false);check(roundtrip(s),false);
});
for(const kind of ['ability','movement','facing','cue','motion','lyrics'])test('retained native '+kind+' events remain content even when disabled',()=>{
  const s=empty(),t=native(kind);t.enabled=false;t.events[0].enabled=false;
  install(s,[t]);check(s,false);check(roundtrip(s),false);
});
test('removing last native event restores empty guidance despite retained track',()=>{
  const s=empty(),t=native('ability');install(s,[t]);check(s,false);t.events=[];check(s,true);check(roundtrip(s),true);
});
test('COUNT-01 empty project and empty track containers display zero',()=>{
  const s=empty();delete s.contentExtra;count(s,0);s.contentExtra={};
  install(s,['ability','movement','facing','cue','motion','lyrics'].map(k=>({...native(k),events:[]})));count(s,0,0);
});
test('COUNT-01 all existing legacy lane contributions stay unchanged',()=>{
  const s=empty();for(const key of ['switchClips','actionClips','lyricClips'])s.dancers[0][key]=[{id:key}];
  s.globalLyrics=[{id:'global'}];s.markers=[{id:'marker',t:0}];count(s,4);
});
test('COUNT-01 two authored skills display two and removal leaves zero after reopen',()=>{
  const s=empty();let all=[];
  for(const id of [31,135]){const e=ability.make({id,type:'action',name:'技能 '+id},{start:'0',cast:id===135?'2':'0',presentation:'1',targetKind:'defaultSelf'},'skill-'+id);
    all=ability.upsert(all,'actor-0',e,'ability-track',ability.performers(s));}
  install(s,all);count(s,2,2);count(roundtrip(s),2,2);
  install(s,ability.remove(ability.remove(all,'skill-31'),'skill-135'));count(s,0,0);count(roundtrip(s),0,0);
});
test('COUNT-01 path points count by canonical event, not number of points',()=>{
  const s=empty();stage.install(s,stage.edit(s,0,{movement:[{time:'1',x:'1',z:'0'},{time:'2',x:'2',z:'0'}],facing:[{time:'2',yaw:'90'}]},'path'));
  count(s,2,2);count(roundtrip(s),2,2);
});
test('COUNT-01 retained disabled native events and legacy clips are additive',()=>{
  const s=empty();install(s,['ability','movement','facing','cue','motion','lyrics'].map(k=>({...native(k),enabled:false,events:[{...native(k).events[0],enabled:false}]})));
  s.dancers[0].actionClips=[{id:1}];s.globalLyrics=[{id:2}];count(s,8,6);
});
test('COUNT-01 canonical projection counts each of six event types only once',()=>{
  const s=empty();install(s,['ability','movement','facing','cue','motion','lyrics'].map(native));count(s,6,6);
  const loaded=roundtrip(s);assert.equal(loaded.dancers[0].actionClips.length,1);assert.equal(loaded.dancers[0].lyricClips.length,1);count(loaded,6,4);
});
console.log(JSON.stringify({passed,failed}));process.exitCode=failed?1:0;
