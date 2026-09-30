// 目录静态身份的原子刷新与离线恢复；不缓存目标条件或输出准入。
(function(root){
  'use strict';
  var SOURCE='ChoreoHelper/actions-v1';
  function validate(c,online){
    if(!c||!Array.isArray(c.emotes)||!c.emotes.length||!Array.isArray(c.actions)||!Array.isArray(c.races)||!Array.isArray(c.classJobs))throw Error('目录不完整，保留上次有效目录');
    if((c.cacheSource!==undefined&&c.cacheSource!==SOURCE)||(c.cacheVersion!==undefined&&(c.cacheVersion!==1||c.cacheSource!==SOURCE)))throw Error('目录来源或版本不支持，保留上次有效目录');
    var ids=new Set();
    c.actions.forEach(function(a){
      if(!a||!Number.isSafeInteger(a.id)||a.id<=0||ids.has(a.id)||(a.type!==undefined&&a.type!=='action')||(online&&a.type!=='action'))throw Error('技能目录身份缺失或冲突，请连接刷新；保留上次有效目录');
      ids.add(a.id);
    });
    if(!c.actions.length)throw Error('技能目录为空，保留上次有效目录');
    return c;
  }
  function typed(c){return !!(c&&c.actions&&c.actions.length&&c.actions.every(function(a){return a.type==='action'}))}
  // 同版内置基础值仅补缺；未知版本/身份差异/已有值均保留缓存原样，不猜测兼容。
  function completeStaticMetadata(c,fallback){
    var reader=root.ChoreoSkillMetadata;
    if(!reader||!c||!fallback||typeof c.gameVersion!=='string'||!/^\d{4}\.\d{2}\.\d{2}\.\d{4}\.\d{4}$/.test(c.gameVersion)||c.gameVersion!==fallback.gameVersion)return c;
    try{validate(fallback,false)}catch(e){return c}
    var byId=new Map(fallback.actions.map(function(a){return [a.id,a]})),changed=false;
    var actions=c.actions.map(function(a){
      if(a.staticMetadata!==undefined||typeof a.name!=='string'||!a.name.trim()||typeof a.jobName!=='string'||!a.jobName.trim()||!Number.isSafeInteger(a.jobId)||a.jobId<0)return a;
      var ref=byId.get(a.id);
      if(!ref||!['id','type','name','jobId','jobName'].every(function(k){return a[k]===ref[k]}))return a;
      var metadata=reader.read(ref);if(!metadata)return a;
      changed=true;return Object.assign({},a,{staticMetadata:metadata});
    });
    return changed?Object.assign({},c,{actions:actions}):c;
  }
  function create(options){
    var generation=0,controller=null,lastApplied=null;
    function begin(){generation++;if(controller)controller.abort();controller=new AbortController();return generation}
    function current(g){return g===generation&&!controller.signal.aborted}
    async function restore(g,existing){
      var c=await options.load();
      if(!current(g)||!c)return false;
      validate(c,false);
      if(typed(existing)&&!typed(c))return false;
      c=completeStaticMetadata(c,options.fallback?options.fallback():null);
      var text=JSON.stringify(c);if(text===lastApplied)return false;
      options.apply(c,true);lastApplied=text;return true;
    }
    async function refresh(g){
      var ctl=controller,timer;
      try{
        var result=await Promise.race([
          Promise.all(['/actions/emotes','/actions/races','/actions','/classjobs'].map(function(p){return options.read(p,{signal:ctl.signal})})),
          new Promise(function(_,reject){timer=setTimeout(function(){ctl.abort();reject(Error('目录刷新超时，保留上次有效目录'))},options.timeoutMs||3000)})
        ]);
        if(!current(g))return false;
        var c=validate({cacheVersion:1,cacheSource:SOURCE,emotes:result[0].emotes,races:result[1].races,actions:Array.isArray(result[2].actions)?result[2].actions.filter(function(a){return a&&a.jobName&&a.jobName.length>0}):null,classJobs:result[3].classJobs,gameVersion:result[2].gameVersion},true);
        var old=await options.load();
        if(!current(g))return false;
        if(old&&(old.cacheVersion!==undefined||old.cacheSource!==undefined))validate(old,false);
        // 保存完整目录事务成功后才发布；失败不会留下半份内存目录。
        await options.save(c,{signal:ctl.signal});
        if(!current(g))return false;
        options.apply(c,false);lastApplied=JSON.stringify(c);return true;
      }finally{clearTimeout(timer)}
    }
    return {begin:begin,current:current,latest:function(g){return g===generation},restore:restore,refresh:refresh,cancel:begin};
  }
  var api={validate:validate,typed:typed,create:create};
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.ChoreoCatalog=api;
})(typeof window!=='undefined'?window:globalThis);
