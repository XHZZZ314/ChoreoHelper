// 技能补资源工作单回归：汇总 → 逐 Action 下一步（missing/unbound/missing-model 分路）；
// --variant 清单模板契约键齐全、占位 sha256 留空（有意被脚本拒绝，防伪造）；导出走既有 Blob 通道零请求。
// 旧行为没有工作单/模板/导出入口——模块应存在与键齐全为红基线。
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');

function loadCoverage(root){
  const ctx=vm.createContext(root);
  vm.runInContext(fs.readFileSync(__dirname+'/choreo-skill-coverage.js','utf8'),ctx);
  return root.ChoreoSkillCoverage;
}

// —— 纯函数：worksheet ——
const C=loadCoverage({console,Map,Set,Number,JSON});
assert.ok(C&&C.worksheet&&C.manifestTemplate&&C.downloadWorksheet,'coverage 模块须提供 worksheet/manifestTemplate/downloadWorksheet（红基线）');

const sum={actions:[
  {actionId:3552,name:'泰然自若',entries:[{dancer:'甲',status:'ready'},{dancer:'乙',status:'missing'}],readyCount:1,missingCount:1},
  {actionId:40,name:'wave',entries:[{dancer:'甲',status:'missing'},{dancer:'乙',status:'missing-model'}],readyCount:0,missingCount:2},
  {actionId:120,name:'care',entries:[{dancer:'丙',status:'unbound'}],readyCount:0,missingCount:1},
  {actionId:999,name:'已齐',entries:[{dancer:'甲',status:'ready'}],readyCount:1,missingCount:0}],
  totals:{actions:4,readyActions:1,missingActions:3}};

const ws=C.worksheet(sum,{projectId:'p1',dancer:'甲',profileId:'prof1',profileName:'角色1',skeletonHash:'h'.repeat(64)});
assert.equal(ws.version,1);assert.equal(ws.kind,'choreo-skill-resource-worksheet');
assert.equal(ws.items.length,3,'只列缺资源 Action');
assert.equal(ws.totals.missingActions,3);
assert.deepEqual(ws.items.map(x=>x.actionId),[3552,40,120]);
let it=ws.items[0];
assert.deepEqual(it.dancers.missing,['乙']);assert.deepEqual(it.dancers.unbound,[]);assert.deepEqual(it.dancers.missingModel,[]);
assert.ok(it.next.length===1&&it.next[0].includes('prepare_bound_actions.py')&&it.next[0].includes('Action3552'),'missing 给出捕获-转换-导入链');
it=ws.items[1];
assert.deepEqual(it.dancers.missing,['甲']);assert.deepEqual(it.dancers.missingModel,['乙']);
assert.equal(it.next.length,2,'缺动画与缺模型分列下一步');
it=ws.items[2];
assert.deepEqual(it.dancers.unbound,['丙']);assert.ok(it.next[0].includes('未绑定角色档案'));
assert.ok(ws.notes.some(n=>n.includes('sha256'))&&ws.notes.some(n=>n.includes('不支持')),'防伪与不支持边界必须常显');
assert.equal(C.worksheet(null,{}).items.length,0,'空汇总不出条目');

// —— 纯函数：manifestTemplate 契约形状 ——
const mt=C.manifestTemplate(ws);
assert.deepEqual(Object.keys(mt).sort(),['binding','papDirectory','papIndex','profile','references','skeletonBinary','skeletonRead','skeletonXml','version'].sort(),'契约键必须齐全');
assert.equal(mt.version,1);
['binding','skeletonRead','skeletonBinary','skeletonXml','profile','papIndex'].forEach(k=>{assert.deepEqual(Object.keys(mt[k]),['path','sha256'],k+' 为路径+哈希对');assert.equal(mt[k].sha256,'',k+' 占位哈希留空=防伪')});
assert.equal(mt.profile.path,'profile.json','档案文件名固定');
assert.deepEqual(mt.references.map(r=>r.path),['action3552-reference.json','action40-reference.json','action120-reference.json'],'每条缺资源 Action 预命名 reference');
mt.references.forEach(r=>assert.equal(r.sha256,''));
assert.deepEqual(Object.keys(C.manifestTemplate(null)),Object.keys(mt),'空工作单模板键不变');

// —— 导出：Blob 通道、零请求、包内含档案文本 ——
(function(){
  const downloads=[];let revoked=[];
  const fakeDoc={createElement(tag){return {tag,set href(v){this._h=v},get href(){return this._h},set download(v){this._d=v},get download(){return this._d},click(){downloads.push({href:this._h,name:this._d})}}}};
  const blobs=[];
  const root={console,Map,Set,Number,JSON,setTimeout,document:fakeDoc,
    URL:{createObjectURL(b){blobs.push(b);return 'blob:worksheet-1'},revokeObjectURL(u){revoked.push(u)}},
    Blob:function(parts,opts){this.parts=parts;this.type=opts&&opts.type}};
  const E=loadCoverage(root);
  const profile={id:'prof1',name:'角色1',skeletonHash:'h'.repeat(64),skeleton:{bones:[{i:0}]}};
  const bundle=E.downloadWorksheet(sum,{projectId:'p1',dancer:'甲',profileId:'prof1'},profile);
  assert.equal(downloads.length,1,'恰好触发一次下载');
  assert.equal(downloads[0].name,'skill-resource-worksheet-p1.json');
  assert.equal(blobs.length,1);assert.equal(blobs[0].type,'application/json');
  assert.equal(bundle.worksheet.items.length,3);
  assert.deepEqual(Object.keys(bundle).sort(),['files','manifestTemplate','worksheet'].sort(),'包内三段固定');
  const parsed=JSON.parse(bundle.files['profile.json']);
  assert.equal(parsed.id,'prof1');assert.ok(parsed.skeleton,'档案文本可直接另存为 profile.json');
  // 无档案也能导出（只有工作单+模板，不带 files.profile）
  const bare=E.downloadWorksheet(sum,{projectId:'p2'},null);
  assert.equal(bare.files['profile.json'],undefined);
})();

console.log('PASS skill resource worksheet: per-action next steps, fail-closed manifest template, offline blob export');
