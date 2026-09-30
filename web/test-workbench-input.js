// 追加间隔输入回归：非法和未完成输入不覆盖原值，离开后回填，正常小数仍用于落点。
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const source=process.env.CHOREO_WORKBENCH_SOURCE||__dirname;
function setup(){
  const nodes=[];
  function node(tag){const n={tagName:tag,children:[],style:{},value:'',textContent:'',setAttribute(k,v){this[k]=v},appendChild(c){this.children.push(c);return c},blur(){if(this.onblur)this.onblur()}};nodes.push(n);return n;}
  const ctx={document:{createElement:node,getElementById:id=>nodes.find(n=>n.id===id)},localStorage:{getItem(){return null}},store:{selectedDancer:0,activeTab:'emote-usual',dancers:[{name:'舞者1',actionClips:[{start:0,duration:3,data:{name:'动作'}}]}]}};
  ctx.window=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(source,'choreo-workbench.js'),'utf8'),ctx);
  const wb=ctx.ChoreoWorkbench;wb.setAppendWait(2);
  let changes=0;wb.addBar({onAddNext(){},onMacro(){},onWaitChange(v){changes++;wb.setAppendWait(v)}});
  return {wb,input:ctx.document.getElementById('wbWaitInput'),error:ctx.document.getElementById('wbWaitError'),changes:()=>changes};
}
let failed=0,passed=0;
function test(name,fn){try{fn();passed++;console.log('PASS '+name)}catch(e){failed++;console.error('FAIL '+name+': '+e.message)}}
test('programmatic invalid values preserve last finite nonnegative wait',()=>{const {wb}=setup();for(const v of [Infinity,-1,NaN,'',null,'1e309']){wb.setAppendWait(v);assert.equal(wb.appendWait(),2)}});
test('empty and partial numeric input preserve current wait and explain validation',()=>{const s=setup();s.input.value='';s.input.oninput();assert.equal(s.wb.appendWait(),2);assert.equal(s.changes(),0);assert.equal(s.input['aria-invalid'],'true');assert.match(s.error.textContent,/当前间隔仍为 2 秒/)});
test('negative and nonfinite input do not shift the next insertion',()=>{const s=setup(),before=s.wb.landingText();for(const v of ['-2','1e309']){s.input.value=v;s.input.oninput();assert.equal(s.wb.landingText(),before);assert.equal(s.changes(),0)}});
test('blur restores previous valid value with explicit feedback',()=>{const s=setup();s.input.value='';s.input.oninput();s.input.onblur();assert.equal(s.input.value,'2');assert.equal(s.input['aria-invalid'],'false');assert.match(s.error.textContent,/已保留原间隔 2 秒/)});
test('valid decimal and zero still update once without rounding the requested wait',()=>{const s=setup();s.input.value='0.2';s.input.oninput();assert.equal(s.wb.appendWait(),0.2);assert.match(s.wb.landingText(),/0.5 秒规则对齐/);s.input.value='0';s.input.oninput();assert.equal(s.wb.appendWait(),0);assert.equal(s.changes(),2);assert.equal(s.error.textContent,'')});
test('Enter restores invalid input without committing an empty value',()=>{const s=setup();s.input.value='';let prevented=false;s.input.onkeydown({key:'Enter',preventDefault(){prevented=true}});assert.equal(prevented,true);assert.equal(s.input.value,'2');assert.equal(s.changes(),0)});
console.log(JSON.stringify({passed,failed}));if(failed)process.exitCode=1;
