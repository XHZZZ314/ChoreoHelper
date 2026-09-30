// B1 时间与位置可信度回归：真实产品模块和采样，内存 DOM/画布依赖，不冒充浏览器验收。
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const sourceFile=n=>process.env.B1_SOURCE&&['choreo-workbench.js','choreo-stage-motion-ui.js'].includes(n)?path.join(process.env.B1_SOURCE,n):path.join(__dirname,n);
function flat(n){return [n,...n.children.flatMap(flat)];}
function element(tag){return {tag,children:[],style:{},dataset:{},value:'',textContent:'',className:'',open:false,hidden:false,
 setAttribute(k,v){this[k]=v},appendChild(n){this.children.push(n);n.parentNode=this;return n},append(...ns){ns.forEach(n=>this.appendChild(n))},
 insertBefore(n,ref){if(!ref)return this.appendChild(n);this.children.splice(this.children.indexOf(ref),0,n);n.parentNode=this;return n},
 replaceChildren(){this.children=[]},remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(x=>x!==this)},
 querySelector(q){return flat(this).find(n=>q[0]==='#'?n.id===q.slice(1):q[0]==='.'?n.className.split(' ').includes(q.slice(1)):false)||null},
 classList:{toggle(){},add(){},remove(){}},focus(){}};}
const modules=['choreo-edit.js','choreo-stage-motion.js','choreo-stage-motion-ui.js','choreo-workbench.js'];
function fixture(count=1){
 const body=element('body'),top=element('div'),hint=element('div'),host=element('div'),cv=element('canvas'),calls=[],toasts=[],history=[];
 top.id='wbTopHost';top.clientWidth=400;top.clientHeight=400;hint.className='wb-top-hint';hint.textContent='original hint';cv.id='wbTopView';host.id='wbCtxHost';
 top.append(cv,hint);body.append(top,host);
 const g={};for(const op of ['save','restore','clearRect','beginPath','moveTo','lineTo','stroke','fill','fillRect','fillText','arc','strokeRect','setLineDash'])g[op]=(...args)=>calls.push({op,args});
 cv.getContext=()=>g;cv.getBoundingClientRect=()=>({left:0,top:0,width:400,height:400});
 const store={projectId:'disposable-deep-review',currentTime:3,selectedDancer:0,pps:60,isPlaying:false,globalLyrics:[],markers:[],
  dancers:Array.from({length:count},(_,i)=>({id:i+1,name:'Synthetic '+(i+1),start:{x:0,z:0,yawDeg:0},actionClips:[],switchClips:[],lyricClips:[]})),contentExtra:{_doc:{extraTracks:[]}}};
 const ctx={store,document:{body,createElement:element,querySelectorAll:()=>[],getElementById:id=>flat(body).find(n=>n.id===id)||null,addEventListener(){},removeEventListener(){}},
  crypto:crypto.webcrypto,setTimeout,clearTimeout,setInterval,clearInterval,localStorage:{getItem(){return null},setItem(){}},
  updateTotalDuration(){},saveHistory(){history.push(1)},render(){},refreshWorkbenchBars(){},showToast:m=>toasts.push(m)};
 ctx.window=ctx;vm.createContext(ctx);for(const f of modules.slice(0,3))vm.runInContext(fs.readFileSync(sourceFile(f),'utf8'),ctx,{filename:f});
 ctx.ChoreoWorkbench={setTab(){},drawTop(){}};
 const M=ctx.ChoreoStageMotion,UI=ctx.ChoreoStageMotionUI;
 return {ctx,store,top,host,cv,g,calls,toasts,history,M,UI,
  setPath(rows,di=0){M.install(store,M.edit(store,di,{movement:rows.map(([time,x,z])=>({time:String(time),x:String(x),z:String(z)})),facing:[]},'test-'+di));},
  sample(t,di=0){return M.sample(store,di,t*1000,ctx.ChoreoEdit.pure.placementFor(store.dancers,di));},
  clip(start=8,duration=2){const c={id:17,start,duration,data:{name:'Synthetic action'}};store.dancers[0].actionClips.push(c);return c;},
  find(id){return ctx.document.getElementById(id)},
  mount(){host.replaceChildren();const bar=UI.renderContext();if(bar)host.appendChild(bar);return bar;},
  workbench(){vm.runInContext(fs.readFileSync(sourceFile('choreo-workbench.js'),'utf8'),ctx,{filename:'choreo-workbench.js'});vm.runInContext(fs.readFileSync(sourceFile('choreo-workbench.js'),'utf8').replace('var api = {','globalThis.__topClick=topClick; var api = {'),ctx);return ctx.ChoreoWorkbench;}
 };
}
let passed=0,failed=0;
function test(name,fn){try{fn();console.log('PASS '+name);passed++}catch(e){console.log('FAIL '+name+'\n'+e.stack);failed++}}
const near=(a,b,eps=1e-9)=>assert.ok(Math.abs(a-b)<=eps,`${a} != ${b}`);
const snapshot=f=>JSON.stringify(f.store);
function apply(f,x=9,z=0){f.UI.openSamePlace(0,f.clip());f.UI.pickSamePlace(x,z);f.find('wbMoveApply').onclick()}
function input(f,label,value){const n=flat(f.host).find(n=>n['aria-label']===label);assert.ok(n,label);n.value=value;n.oninput({target:n})}
const project=(x,z)=>({sx:x,sy:z});
test('HF-08 top drawing / hit test / real 3D placement at 0 middle end paused seek',()=>{
 const f=fixture(2);f.store.dancers[1].start={x:-8,z:-5,yawDeg:0};f.setPath([[6,6,2]]);
 const preview=fs.readFileSync(path.join(__dirname,'preview3d.js'),'utf8');
 vm.runInContext(preview.slice(preview.indexOf('  function placementOf('),preview.indexOf('  function applyPlacement()')),f.ctx);
 const w=f.workbench();
 // Path priority is intentionally left intact; disable its handler only to exercise dancer-marker hit branch.
 f.UI.pickTopPath=()=>false;
 for(const t of [0,3,6,1.5,6,0]){
  f.store.currentTime=t;f.store.selectedDancer=0;f.calls.length=0;w.drawTop();
  const tr=w.topViewTransform(),arc=f.calls.find(c=>c.op==='arc'&&c.args[2]===9),p=f.ctx.placementOf(0,2);
  near((arc.args[0]-tr.w/2)/tr.sc,p.x);near((arc.args[1]-tr.h/2)/tr.sc,p.z);
  f.store.selectedDancer=1;f.ctx.__topClick({clientX:tr.w/2+p.x*tr.sc,clientY:tr.h/2+p.z*tr.sc});assert.equal(f.store.selectedDancer,0);
 }
});
for(const [name,rows] of [['empty',[]],['prior hold',[[2,0,0]]],['prior interpolation',[[2,0,0],[10,8,0],[12,8,0]]]])test('HF-02 T1 '+name+' real before/after window samples',()=>{
 const f=fixture();if(rows.length)f.setPath(rows);
 const before=[0,1,2,5,7.999,8,11,12,20].map(t=>f.sample(t).x);
 apply(f);assert.equal(f.history.length,1);
 [0,1,2,5,7.999].forEach((t,i)=>near(f.sample(t).x,before[i],.001));near(f.sample(8).x,before[5]);near(f.sample(9).x,(before[5]+9)/2);near(f.sample(10).x,9);
 if(name==='prior interpolation'){near(before[3],3);near(before[5],6);near(before[6],8);near(f.sample(9).x,7.5);near(f.sample(11).x,8.5);near(f.sample(12).x,before[7]);near(f.sample(20).x,before[8])}
});
test('HF-02 explicit reconnect and END terminal preview before Apply',()=>{
 const f=fixture();f.setPath([[2,0,0],[10,8,0],[12,8,0]]);f.UI.openSamePlace(0,f.clip());f.UI.pickSamePlace(9,0);
 assert.match(f.find('wbMoveWindow').textContent,/10s.*12s.*重连/);
 const g=fixture();g.setPath([[2,2,0],[4,4,0]]);near(g.sample(20).x,4);g.UI.openSamePlace(0,g.clip());g.UI.pickSamePlace(7,0);
 assert.match(g.find('wbMoveWindow').textContent,/10s.*END/);assert.match(g.find('wbMoveWindow').textContent,/4.*7/);
 g.find('wbMoveApply').onclick();near(g.sample(20).x,7);
});
test('HF-02 incoming gait, actor base, quantized anchor and unchanged facing',()=>{
 const f=fixture(2);f.store.dancers[1].start={x:2,z:-1,yawDeg:15};
 f.M.install(f.store,f.M.edit(f.store,1,{movement:[{time:'8',x:'0',z:'0',move:'run'},{time:'13',x:'5',z:'3'}],facing:[{time:'10',yaw:'70'}]},'gait'));
 const facing=JSON.stringify(f.M.tracks(f.store).find(t=>t.type==='facing'));
 const c={id:99,start:8,duration:4,data:{name:'B'}};f.store.dancers[1].actionClips.push(c);
 f.UI.openSamePlace(1,c);f.UI.pickSamePlace(4,2);f.find('wbMoveApply').onclick();assert.equal(f.M.nodes(f.store,1).movement[0].move,'run');assert.equal(JSON.stringify(f.M.tracks(f.store).find(t=>t.type==='facing')),facing);
 const g=fixture();g.store.dancers[0].start={x:2,z:-1,yawDeg:0};g.setPath([[13,5,3]]);const pre=g.sample(5);apply(g);near(g.sample(5).x,pre.x,.001);near(g.sample(5).z,pre.z,.001);assert.equal(g.history.length,1);
});
for(const finalCount of [499,500,501])test('HF-02 final capacity '+finalCount,()=>{
 const f=fixture();const count=finalCount-1;f.setPath(Array.from({length:count},(_,i)=>[i+1,0,0]));
 const clip=f.clip(.5,.5);f.UI.openSamePlace(0,clip);f.UI.pickSamePlace(1,0);const old=snapshot(f);f.find('wbMoveApply').onclick();
 if(finalCount<=500){assert.equal(f.history.length,1);assert.equal(f.M.nodes(f.store,0).movement.length,finalCount)}else{assert.equal(snapshot(f),old);assert.equal(f.history.length,0);assert.match(f.find('wbMoveHint').textContent,/500/)}
});
for(const kind of ['locked','disabled','eventLocked','foreign','badTime','badStart','playing'])test('HF-02 original-state refusal '+kind,()=>{
 const f=fixture();f.setPath([[2,0,0]]);const track=f.M.tracks(f.store)[0];
 if(kind==='locked')track.locked=true;if(kind==='disabled')track.enabled=false;if(kind==='eventLocked')track.events[0].locked=true;
 if(kind==='foreign')f.M.tracks(f.store).push({id:'foreign',type:'movement',performerId:'actor-1',events:[{enabled:true}]});
 // B9 机械更新（旧↔新并列）：旧链 A 直读元素 .value（直写即生效）；B9 统一草稿后段子表单值存状态，
 // 须走真实输入路径（oninput 同步状态）——断言语义等价：到达非法（＝出发 8s）仍拒绝零写入。
 f.UI.openSamePlace(0,f.clip(kind==='badStart'?-1:8));f.UI.pickSamePlace(9,0);if(kind==='badTime'){var arrIn=f.find('wbMoveArrival');arrIn.value='8';arrIn.oninput({target:arrIn})}if(kind==='playing')f.store.isPlaying=true;
 const old=snapshot(f);f.find('wbMoveApply').onclick();assert.equal(snapshot(f),old);assert.equal(f.history.length,0);assert.ok(f.UI.samePlaceActive());
});
test('HF-04 draft line / markers / labels share geometry, saved path suppressed, invalid retains last valid',()=>{
 const f=fixture();f.setPath([[6,6,0]]);f.UI.selectMotion(0);f.mount();const saved=snapshot(f);
 input(f,'路径节点1 X 米','9');f.calls.length=0;f.UI.drawSelected(f.g,project);
 assert.ok(f.calls.some(c=>c.op==='lineTo'&&c.args[0]===9));assert.ok(f.calls.some(c=>c.op==='fillRect'&&c.args[0]===6));assert.ok(f.calls.some(c=>c.op==='fillText'&&c.args[0]==='1·6s'));
 assert.equal(snapshot(f),saved);
 input(f,'路径节点1 X 米','NaN');f.calls.length=0;f.UI.drawSelected(f.g,project);assert.ok(f.calls.some(c=>c.op==='lineTo'&&c.args[0]===9));assert.match(f.UI.sessionState().status,/数字/);assert.equal(snapshot(f),saved);
 const w=f.workbench();f.calls.length=0;w.drawTop();const tr=w.topViewTransform();assert.ok(!f.calls.some(c=>c.op==='lineTo'&&Math.abs(c.args[0]-(200+6*tr.sc))<1e-9&&Math.abs(c.args[1]-200)<1e-9));
 f.find('wbMotionCancel').onclick();f.mount();f.calls.length=0;f.UI.drawSelected(f.g,project);assert.ok(f.calls.some(c=>c.op==='lineTo'&&c.args[0]===6));assert.equal(snapshot(f),saved);
});
test('HF-01 destination refinement preserves duration/arrival, only explicit reset uses default',()=>{
 const f=fixture();f.UI.openSamePlace(0,f.clip());f.UI.pickSamePlace(4,0);const dur=f.find('wbMoveDur');dur.value='5';dur.oninput();
 f.UI.pickSamePlace(5,1);assert.equal(dur.value,'5');assert.equal(f.find('wbMoveArrival').value,'13');assert.match(f.find('wbMoveHint').textContent,/保留/);
 const reset=f.find('wbMoveReset');assert.ok(reset);assert.equal(reset.textContent,'重置为默认');reset.onclick();assert.equal(dur.value,'2');assert.equal(f.find('wbMoveArrival').value,'10');assert.equal(f.history.length,0);
 dur.value='';dur.oninput();f.UI.pickSamePlace(6,2);assert.equal(dur.value,'');assert.equal(f.find('wbMoveArrival').value,'');
});

test('HF-02 outside raw points and independent facing extensions survive',()=>{
 const f=fixture();f.M.install(f.store,f.M.edit(f.store,0,{movement:[{time:'2',x:'0',z:'0'},{time:'10',x:'8',z:'0'},{time:'12',x:'8',z:'0'}],facing:[{time:'5',yaw:'50'}]},'raw'));
 const m=f.M.tracks(f.store).find(t=>t.type==='movement'),face=f.M.tracks(f.store).find(t=>t.type==='facing');
 m.events[0].data.stageMotion.points[0].custom={keep:[1,2]};m.events[0].data.stageMotion.points[2].custom={keep:[3]};face.events[0].data.stageMotion.points[0].custom={keep:true};
 const oldPoints=m.events[0].data.stageMotion.points.map(p=>JSON.stringify(p)),oldFace=JSON.stringify(face);apply(f);
 const pts=f.M.tracks(f.store).find(t=>t.type==='movement').events[0].data.stageMotion.points;assert.equal(JSON.stringify(pts[0]),oldPoints[0]);assert.equal(JSON.stringify(pts.at(-1)),oldPoints[2]);assert.equal(JSON.stringify(f.M.tracks(f.store).find(t=>t.type==='facing')),oldFace);
});
console.log(JSON.stringify({passed,failed,tier:'mechanism; not browser usability'}));process.exitCode=failed?1:0;
