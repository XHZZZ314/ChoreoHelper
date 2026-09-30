// 首条旅程：添加入口须真正展开动作库；复用已验探针的隔离浏览器与键鼠工具，不重跑其旧验收。
'use strict';
const fs = require('node:fs'), path = require('node:path');
const width = Number(process.env.CHOREO_ENTRY_WIDTH || 640);
if (![640, 1440].includes(width)) throw Error('CHOREO_ENTRY_WIDTH must be 640 or 1440');
const original = fs.readFileSync(path.join(__dirname, 'test-first-macro-journey-browser.js'), 'utf8');
const marker = '(async()=>{try{';
if (!original.includes(marker)) throw Error('Existing harness boundary changed');
const harness = original.slice(0, original.indexOf(marker))
  .replace('width:1440,height:1000', 'width:' + width + ',height:1000');
const scenario = String.raw`
// Only read DOM/production documents; all product actions use CDP mouse/keyboard.
const documents = [], observations = [];
function observe(name, ok) { checks.push({name, ok:!!ok}); console.log((ok?'PASS ':'FAIL ')+name); }
async function visibleLibrary() {
 return ev('(()=>{const n=document.querySelector(".act-item .ai-name");if(!n)return false;const r=n.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2;return r.width>0&&r.height>0&&x>0&&x<innerWidth&&y>0&&y<innerHeight&&n.contains(document.elementFromPoint(x,y))})()');
}
async function documentNow() { return JSON.parse(await tracksJson()); }
function clean(doc) { return require('node:vm').runInNewContext('('+cleanDocJs+')(doc)', {doc}); }
function equalDocs(a,b) { assert.deepStrictEqual(JSON.parse(JSON.stringify(clean(a))),JSON.parse(JSON.stringify(clean(b)))); }
async function recordView(name) {
 const row=await ev('(()=>{const n=document.querySelector(".sidebar"),r=n&&n.getBoundingClientRect();return {body:document.body.className,sidebar:n&&n.className,rect:r&&{left:r.left,right:r.right,width:r.width},backdrop:document.getElementById("sbBackdrop").className,guide:(document.querySelector(".tl-empty-guide")||{}).textContent}})()');
 observations.push({name,...row}); await shot(name);
}
async function hideLibrary() {
 if(await visibleLibrary()) await button('动作库','.toolbar-nav');
 check('动作库可由原工具栏收起',!(await visibleLibrary()));
}
(async()=>{try{
 await open();
 // Synthetic project naming via native prompt protocol, separate from user journey.
 await button('项目','.toolbar-nav'); await until('!!document.getElementById("projectCenterModal")');
 expectedPrompt='合成观察—添加入口'; await button('新建项目','#projectCenterModal');
 await until('store.projectName==="合成观察—添加入口"&&!document.getElementById("projectCenterModal")');
 const empty=await documentNow(), h0=await historyLen();
 await click('#wbEmptyStart'); await until('!!document.getElementById("wbAddBar")'); await sleep(250);
 await recordView('01-first-action');
 observe('添加第一个动作：一次点击后动作列表直接可点',await visibleLibrary());
 equalDocs(empty,await documentNow()); check('进入不修改完整生产文档或历史',await historyLen()===h0);
 // Red baseline recovery is explicit UI navigation, never an internal function.
 if(!(await visibleLibrary())) { step('baseline-recovery',{action:'toolbar 动作库 via pointer'}); await button('动作库','.toolbar-nav'); }
 await click('.act-item .ai-name',0); await until('store.dancers[0].actionClips.length===1');
 const first=await documentNow(), h1=await historyLen();
 check('首条按原规则从 0 秒开始，且一次历史',await ev('store.dancers[0].actionClips[0].start===0')&&h1===h0+1);
 await hideLibrary();
 await click('[data-wb="add-next"]'); await sleep(250); await recordView('02-add-next');
 observe('接着添加：收起后一次点击重新展开可点列表',await visibleLibrary());
 equalDocs(first,await documentNow()); check('展开动作库不修改文档或历史',await historyLen()===h1);
 if(!(await visibleLibrary())) { step('baseline-recovery',{action:'toolbar 动作库 via pointer'}); await button('动作库','.toolbar-nav'); }
 await click('.act-item .ai-name',1); await until('store.dancers[0].actionClips.length===2');
 check('第二条接在第一条末尾，一次历史',await ev('store.dancers[0].actionClips[1].start===store.dancers[0].actionClips[0].duration')&&(await historyLen())===h1+1);
 await hideLibrary();
 const second=await documentNow();
 await click('button[title^="撤销上一步编辑"]'); await until('store.dancers[0].actionClips.length===1');
 equalDocs(first,await documentNow()); check('一次撤销恢复首条完整生产文档',true);
 // Select A and enter editing/stage through visible controls after library recovery.
 const id=await ev('store.dancers[0].actionClips[0].id'); await clickClip(id);
 await until('!!document.getElementById("wbCtxDurEdit")');
 await type('#wbCtxDurEdit','2'); await click('#wbCtxTimeCancel');
 equalDocs(first,await documentNow()); check('选中后取消时间草稿仍零写',true);
 await click('#wbCtxMove'); await until('!!document.getElementById("wbMoveBar")');
 await shot('03-stage');
 await button('取消','#wbMoveBar');
 equalDocs(first,await documentNow()); check('从时间轴进入舞台再取消仍零写',true);
 documents.push({empty,first,second,restored:await documentNow()});
 check('无 JavaScript 异常',errors.length===0);
 observe('源与仓库 dist 字节一致',fs.readFileSync(path.join(__dirname,'choreo-app.js')).equals(fs.readFileSync(path.join(__dirname,'dist/ChoreoHelper/choreo-app.js'))));
 if(checks.some(c=>!c.ok))process.exitCode=1;
 }catch(e){json('failure',{message:e.message,stack:e.stack});console.error(e);process.exitCode=1;if(ws)await shot('failure').catch(()=>{})}
 finally{json('checks',checks);json('observations',observations);json('documents',documents);json('steps',steps);json('errors',errors);json('requests',requests);await close();}
})();
`;
new Function('require', '__dirname', harness + scenario)(require, __dirname);
