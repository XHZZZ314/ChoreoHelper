// 批量技能资源先完整校验，再按原有事务逐项保存；中断保留已完成项，不覆盖已有私人动作。
(function(root){
  'use strict';
  async function run(files,profile,options){
    var list=Array.from(files),pending=[],ids=new Set(),result={saved:[],kept:[]};
    function current(){if(!options.current())throw Error('项目或角色档案已变化，导入已停止')}
    try{
      current();
      if(!profile||!profile.skeletonHash)throw Error('请先绑定有骨架的角色档案');
      if(!list.length||list.length>100)throw Error('每次请选择1至100个技能动作文件');
      if(list.reduce((n,f)=>n+f.size,0)>128*1024*1024)throw Error('本批技能文件超过128MiB');
      for(const file of list){
        current();if(file.size>16*1024*1024)throw Error(file.name+' 超过16MiB');
        var clip=JSON.parse(await file.text());current();
        var id=clip&&clip.motionBinding&&clip.motionBinding.source&&clip.motionBinding.source.id;
        if(!Number.isInteger(id)||id<=0)throw Error(file.name+' 缺少真实 Action 编号');
        root.ChoreoSkillMotion.validate(clip,id,{profileId:profile.id,fingerprint:profile.skeletonHash,skeleton:profile.skeleton});
        if(ids.has(id))throw Error('本批重复包含 Action'+id);ids.add(id);pending.push({id,clip});
      }
      for(const item of pending){
        current();var name=root.ChoreoSkillMotion.name(item.id),existing=await options.read(name,profile.id);current();
        if(existing){result.kept.push(item.id);continue}
        await options.write(name,item.clip,profile.id);result.saved.push(item.id);current();
      }
      return result;
    }catch(e){e.importResult=result;throw e}
  }
  root.ChoreoSkillImport={run};
})(typeof window!=='undefined'?window:globalThis);
