// 技能编排目标规则：仅解释本机类别并绑定编辑会话，不证明七条件或技能输出。
(function(root){
  'use strict';
  var flags=['self','hostile','party','alliance','ally','ownPet','partyPet','area','pvp'];
  var names={self:'自身',hostile:'敌人',party:'队伍成员',alliance:'团队成员',ally:'普通友方',ownPet:'自己的宠物',partyPet:'队伍宠物'};
  function known(r){return !!r&&r.version===1&&flags.every(k=>typeof r[k]==='boolean')}
  function assess(r,kind){
    if(!known(r))return {state:'unknown',reason:'未核验：本机目标规则未知、缺字段或已失效'};
    if(r.pvp)return {state:'blocked',reason:'PvP 技能不在当前编排支持范围'};
    if(r.area&&kind!=='ground')return {state:'blocked',reason:'地面技能必须声明地面坐标，不能改用敌人或舞者类别'};
    var key={self:'self',party:'party',alliance:'alliance',ally:'ally',enemyMarker:'hostile',defaultSelf:'self',ownPet:'ownPet',partyPet:'partyPet',ground:'area'}[kind];
    if(!key)return {state:'unknown',reason:'请选择排练目标类型'};
    if(!r[key])return {state:'blocked',reason:'该技能本机规则不支持'+({self:'自身',party:'队伍成员',alliance:'团队成员',ally:'普通友方',enemyMarker:'敌人',defaultSelf:'无目标自身',ownPet:'自己的宠物',partyPet:'队伍宠物',ground:'地面坐标'}[kind])+'；请明确修改目标'};
    // V1 unselectedSelfAllowed 只授权只读检查，绝不是原生缺省施法语义。
    if(kind==='defaultSelf')return {state:'unknown',reason:'未核验：本机 V1 未提供原生无目标自动自身规则；可作用于自身、可只读检查自身均不能证明自动释放'};
    return {state:'allowed',reason:'目标类别与本机规则相符；排练舞者不证明实际同队、友好、可选、范围或可释放。七条件未检查；目标声明不会授予执行许可'};
  }
  function describe(r){
    if(!known(r))return '未核验：请连接支持完整目标规则的本机插件后刷新。可保留草稿，不代表验证通过。';
    var list=Object.keys(names).filter(k=>r[k]).map(k=>names[k]);
    var text='本机技能允许目标：'+(list.join('、')||'没有当前可用类别')+'。';
    if(r.self&&!['hostile','party','alliance','ally','ownPet','partyPet','area'].some(k=>r[k]))text+='固有自身类别；这不证明无目标时的原生自动释放行为。';
    if(r.hostile&&!r.self&&!r.party&&!r.alliance&&!r.ally)text+='需要明确敌人声明。';
    if(r.party||r.alliance||r.ally)text+='队伍、团队、普通友方分别核对，不互相代替。';
    if(r.alliance)text+='团队成员需单独声明，不能用队友或普通友方冒充。';
    if(r.ownPet||r.partyPet)text+='宠物按所属角色与独立标记声明，不代表主人本体。';
    if(r.area)text+='地面目标使用明确的舞台坐标；不自动转换为游戏落点。';
    if(r.pvp)text+='PvP 技能不在支持范围。';
    return text+'本机 V1 不提供原生无目标自动自身规则。静态类别说明不是当前原生条件。';
  }
  function create(opts){
    var catalog=known(opts.catalogRules)?JSON.parse(JSON.stringify(opts.catalogRules)):null;
    var id=opts.id,rules=null,closed=false,sequence=0,at=0,reason='未核验：尚未读取本机规则',pending=null;
    var now=opts.now||Date.now;
    function valid(){return !closed&&opts.current()&&opts.connected()}
    function view(){if(closed||!opts.current())return {rules:null,reason:'编辑会话已失效'};if(!valid()||(rules&&now()-at>15000)){rules=null;reason='未核验：连接或实时读取已失效，请刷新'}return rules?{rules,reason}:catalog?{rules:catalog,reason:'使用离线目录的静态目标类别；不表示当前职业、目标或冷却已检查'}:{rules:null,reason}}
    function emit(){if(!closed&&opts.changed)opts.changed(view())}
    function refresh(){
      if(pending)return pending;
      rules=null;reason='未核验：正在读取本机目标规则';emit();
      if(!valid())return Promise.resolve(false);
      var token=++sequence,timer;
      pending=Promise.race([Promise.resolve().then(()=>opts.read('/x1/ability-read?mode=context&actionId='+id+'&_='+now())),
        new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('只读响应正文超时')),3000)})]).then(function(response){
        if(token!==sequence||!valid())return false;
        if(response.schemaVersion!==1||response.error||!response.context||!response.context.available||!response.context.contextKey||
          !response.skill||response.skill.type!=='action'||response.skill.id!==id||!known(response.skill.targetRules))throw Error('技能身份或完整目标规则未确认');
        rules=JSON.parse(JSON.stringify(response.skill.targetRules));at=now();reason='本次读取的静态目标类别；不含七条件检查';return true;
      }).catch(function(e){if(token===sequence&&!closed){rules=null;reason='未核验：'+(e.detail||e.message)}return false})
        .finally(function(){clearTimeout(timer);pending=null;emit()});
      return pending;
    }
    return {view,refresh,tick:function(){var had=rules;if(!valid())sequence++;view();if(had&&!rules){sequence++;emit()}},close:function(){closed=true;sequence++;rules=null}};
  }
  root.ChoreoAbilityPlanTargets={known,assess,describe,create};
})(typeof window!=='undefined'?window:globalThis);
