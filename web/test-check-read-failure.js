// 资料库读取失败回归：运行真实体检规则及UI调度，未知不得当作首启空库。
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=process.env.CHOREO_CHECK_UI_SOURCE||path.join(__dirname,'choreo-check-ui.js');
let passed=0,failed=0;
class Node {
  constructor(tag){this.tagName=tag;this.children=[];this.style={};this.isConnected=true;this._text=''}
  appendChild(n){this.children.push(n);n.parentNode=this;return n}
  insertBefore(n,ref){if(!ref)return this.appendChild(n);this.children.splice(this.children.indexOf(ref),0,n);n.parentNode=this;return n}
  removeChild(n){this.children.splice(this.children.indexOf(n),1);n.isConnected=false}
  remove(){if(this.parentNode)this.parentNode.removeChild(this)}
  querySelector(q){return this.children.find(n=>q==='.'+n.className)||null}
  set textContent(v){this._text=String(v);this.children=[]}
  get textContent(){return this._text+this.children.map(n=>n.textContent).join('')}
  set innerHTML(v){this.textContent=''}
}
function setup(overrides={}){
  const badge=new Node('button'),body=new Node('body');body.appendChild(badge);
  const lib=Object.assign({available:()=>true,clipIndex:async()=>[],allClipIndex:async()=>({}),listProfiles:async()=>[],getActiveProfile:async()=>null,getSkeletonInfo:async()=>null},overrides);
  const store={appReady:true,dancers:[{actionClips:[],switchClips:[],lyricClips:[]}],globalLyrics:[],markers:[],contentExtra:{},totalDuration:300,measuredDur:{},jobMap:{}};
  const ctx={store,ChoreoLibrary:lib,_projectOperation:0,currentProjectOperation:()=>true,setInterval:()=>0,clearInterval(){},
    el(tag,cls,text){const n=new Node(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n},
    document:{body,getElementById:id=>id==='btnCheck'?badge:null,createElement:tag=>new Node(tag),createTextNode:text=>{const n=new Node('#text');n.textContent=text;return n}}};ctx.window=ctx;vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'choreo-check.js'),'utf8'),ctx);
  vm.runInContext(fs.readFileSync(source,'utf8'),ctx);
  return {ctx,lib,badge,body};
}
async function verify(name,overrides,expectedYellow,entry){
  try{
    const {ctx,badge,body}=setup(overrides);
    if(entry==='modal'){
      ctx.showCheckModal();for(let i=0;i<40;i++)await Promise.resolve();
      assert.match(body.textContent,/检查完成/,'modal finishes its actual async read path');
      assert.equal(body.textContent.includes('首次使用：本地资料库还是空的'),expectedYellow,'modal guidance');
    }else await (entry==='realtime'?ctx.runRealtimeCheck():ctx.__checkRun());
    const raw=ctx.store.checkIssues.find(x=>x.rule==='no-skeleton');assert.equal(raw?.level,'red','underlying rule stays red');
    assert.equal(ctx._checkEmptyLibraryDisplay,expectedYellow,'empty display decision');
    assert.equal(ctx.checkDisplayIssues(ctx.store.checkIssues).find(x=>x.rule==='no-skeleton')?.level,expectedYellow?'yellow':'red');
    assert.equal(badge.children[0]?.textContent,expectedYellow?' · 黄1':' · 红1','visible badge');
    passed++;console.log('PASS '+entry+' '+name);
  }catch(e){failed++;console.error('FAIL '+entry+' '+name+': '+e.message)}
}
(async()=>{
  for(const entry of ['realtime','diagnostic','modal']){
    await verify('confirmed empty library',{},true,entry);
    for(const method of ['clipIndex','allClipIndex','listProfiles','getActiveProfile','getSkeletonInfo']){
      await verify(method+' rejects',{[method]:async()=>{throw Error('simulated read failure')}},false,entry);
      await verify(method+' returns unknown',{[method]:async()=>undefined},false,entry);
    }
    await verify('pending clips',{allClipIndex:async()=>({__pending__:[{name:'pending'}]})},false,entry);
    await verify('other profile clips',{allClipIndex:async()=>({other:[{name:'known'}]}),listProfiles:async()=>[{id:'other'}]},false,entry);
    await verify('empty existing profile',{listProfiles:async()=>[{id:'other'}]},false,entry);
    await verify('active profile exists despite empty profile list',{getActiveProfile:async()=>({id:'active'})},false,entry);
  }
  try{
    const {ctx,lib}=setup({getActiveProfile:async()=>{throw Error('read failed')}});await ctx.runRealtimeCheck();assert.equal(ctx._checkEmptyLibraryDisplay,false);
    lib.getActiveProfile=async()=>null;await ctx.__checkRun();assert.equal(ctx._checkEmptyLibraryDisplay,true);assert.equal(ctx.store.checkIssues.find(x=>x.rule==='no-skeleton').level,'red');passed++;console.log('PASS forced fresh read recovers after failure');
  }catch(e){failed++;console.error('FAIL recovery: '+e.message)}
  console.log(JSON.stringify({passed,failed}));process.exitCode=failed?1:0;
})();
