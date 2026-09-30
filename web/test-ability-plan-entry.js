// 技能编排入口红绿：真实技能不写普通动作轨、不从同名表情猜身份；
// TASK-20260918-PLAYER-UX-SIMPLIFY B1 起：侧栏点技能=默认落条（quickAdd/quickAddAll），
// 不再先弹编排编辑窗；编辑窗经技能条点击进入（ability-ui 覆盖）。
'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
// OVERHAUL 批 C 第六步迁移：renderActionList 已随 RENDER 外壳搬到 choreo-app-render.js 且为该件
// 件尾函数——切片改读拆分件并切到件尾（旧尾标记 var _mqJustDone= 已随五步拆走；setLoopPoint/renderRuler
// 件尾先例）；CHOREO_PLAN_APP 指旧目录时仍读旧 choreo-app.js 两标记切片，对拍红测语义不变。
const source=fs.readFileSync(process.env.CHOREO_PLAN_APP||__dirname+'/choreo-app.js','utf8');
const renderSource=process.env.CHOREO_PLAN_APP?source:fs.readFileSync(__dirname+'/choreo-app-render.js','utf8');
const code=process.env.CHOREO_PLAN_APP?source.slice(source.indexOf('function renderActionList(){'),source.indexOf('var _mqJustDone=')):renderSource.slice(renderSource.indexOf('function renderActionList(){'));
function node(tag,cls,text){return {tag,cls,text,style:{},children:[],appendChild(n){this.children.push(n)},setAttribute(){}}}
const skill={id:120,type:'action',name:'治疗',duration:1.5};
const quick=[],quickAll=[],opened=[],motion=[],store={activeTab:'skill-all',measuredDur:{},selectedDancer:0,addToAll:false,dancers:[{actionClips:[]}],currentTime:7};
const ctx={window:{},store,getFilteredActions:()=>[skill],el:node,document:{createElement:node,createTextNode:t=>node('','',t)},
 abilityLaneEnd:()=>4.5,abilityLaneEndAll:()=>6,
 ChoreoAbilityRead:{isSkill:i=>i.type==='action',open(){}},
 ChoreoAbilityUI:{open:(...a)=>opened.push(a),quickAdd:(...a)=>quick.push(a),quickAddAll:(...a)=>quickAll.push(a)},
 apiFetch(){},showToast(){},addClip:(...a)=>motion.push(a)};
ctx.window=ctx;vm.runInNewContext(code,ctx);ctx.renderActionList().children.find(n=>n.cls==='act-cols').children[0].onclick();
assert.equal(motion.length,0,'技能不得落入普通动作轨');
assert.equal(quick.length,1,'点技能应默认落条');assert.equal(quick[0][0],skill);assert.equal(quick[0][1],0);assert.equal(quick[0][2],4.5,'时刻=该舞者技能轨末尾');
assert.equal(quickAll.length,0);assert.equal(opened.length,0,'默认落条不再先弹编辑窗');
store.addToAll=true;ctx.renderActionList().children.find(n=>n.cls==='act-cols').children[0].onclick();
assert.equal(quickAll.length,1,'勾选添加到全部舞者时整批落条');assert.equal(quickAll[0][0],skill);assert.equal(quickAll[0][1],6);
assert.equal(quick.length,1);assert.equal(opened.length,0);
store.addToAll=false;delete skill.type;const old=ctx.renderActionList().children.find(n=>n.cls==='act-cols').children[0];let prevented=false;
old.ondragstart({preventDefault(){prevented=true},dataTransfer:{setData(){throw Error('旧技能不得开始拖入普通动作轨')}}});old.onclick();
assert.equal(prevented,true);assert.equal(quick.length+quickAll.length+opened.length,2,'旧目录缺身份：零新增落条/弹窗（前两次点击的 1+1 保持不变）');assert.equal(motion.length,0);
console.log('ability authoring entry passed');
