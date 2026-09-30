// P4（操作人体工学）：Ctrl+K 命令面板——居中浮层 + 过滤输入 + 键盘导航列表的纯视图模块；
// 命令注册表由 choreo-app.js 在打开时注入（title 必填、kw 可选别名、run 回调），本模块不含业务逻辑。
'use strict';
(function(root){
  var MASK_ID='cmdkMask',returnFocus=null;
  function close(){
    var d=root.document;
    var m=d&&d.getElementById(MASK_ID);
    if(m)m.remove();
    var previous=returnFocus;returnFocus=null;if(previous&&previous.isConnected&&previous.focus)previous.focus();
  }
  function isOpen(){
    var d=root.document;
    return !!(d&&d.getElementById(MASK_ID));
  }
  function open(opts){
    var d=root.document;
    if(!d||!d.body)return false;
    close();returnFocus=d.activeElement;
    var commands=((opts&&opts.commands)||[]).filter(function(c){return c&&c.title&&typeof c.run==='function'});
    var mask=d.createElement('div');mask.className='cmdk-mask';mask.id=MASK_ID;
    var panel=d.createElement('div');panel.className='cmdk-panel';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','查找操作');
    var input=d.createElement('input');input.type='text';input.className='cmdk-input';
    input.placeholder='查找操作…';
    input.setAttribute('aria-label','查找操作');input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-expanded','true');input.setAttribute('aria-controls','cmdkList');
    var list=d.createElement('div');list.className='cmdk-list';list.id='cmdkList';list.setAttribute('role','listbox');list.setAttribute('aria-label','操作');
    var active=0,visible=[];
    function renderList(){
      var q=input.value.trim().toLowerCase();
      visible=commands.filter(function(c){
        if(!q)return true;
        return String(c.title).toLowerCase().indexOf(q)>=0||(c.kw&&String(c.kw).toLowerCase().indexOf(q)>=0);
      });
      if(active>=visible.length)active=Math.max(0,visible.length-1);
      list.textContent='';input.removeAttribute('aria-activedescendant');
      if(!visible.length){
        var em=d.createElement('div');em.className='cmdk-empty';em.textContent='没有匹配的命令';
        list.appendChild(em);return;
      }
      visible.forEach(function(c,i){
        var it=d.createElement('div');it.className='cmdk-it'+(i===active?' active':'');
        var t=d.createElement('span');t.textContent=c.title;it.appendChild(t);
        if(c.hint){var k=d.createElement('kbd');k.className='cmdk-kw';k.textContent=c.hint;it.appendChild(k)}
        it.id='cmdkOption'+i;it.setAttribute('role','option');it.setAttribute('aria-selected',i===active?'true':'false');
        if(i===active)input.setAttribute('aria-activedescendant',it.id);
        it.onclick=function(){close();c.run()}; // 鼠标点击同样执行并关闭
        list.appendChild(it);
      });
    }
    function showActive(){var it=list.children[active];if(it&&it.scrollIntoView)it.scrollIntoView({block:'nearest'})}
    input.oninput=function(){active=0;renderList();showActive()};
    // 只拦面板自己消费的键并阻断冒泡——不影响 bootstrap 文档级快捷键（输入框守卫本来就跳过）
    input.onkeydown=function(e){
      if(e.isComposing||e.keyCode===229)return;
      if(e.key==='Tab'){e.preventDefault();e.stopPropagation()}
      else if(e.key==='ArrowDown'){e.preventDefault();e.stopPropagation();if(visible.length){active=(active+1)%visible.length;renderList();showActive()}}
      else if(e.key==='ArrowUp'){e.preventDefault();e.stopPropagation();if(visible.length){active=(active-1+visible.length)%visible.length;renderList();showActive()}}
      else if(e.key==='Enter'){e.preventDefault();e.stopPropagation();var c=visible[active];close();if(c)c.run()}
      else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close()}
    };
    mask.onclick=function(e){if(e.target===mask)close()}; // 点掩罩本身=不执行直接关；点面板不关
    var hint=d.createElement('div');hint.className='cmdk-help';hint.textContent='↑↓ 选择 · Enter 执行 · Esc 关闭';
    panel.appendChild(input);panel.appendChild(list);panel.appendChild(hint);mask.appendChild(panel);
    d.body.appendChild(mask);
    renderList();
    input.focus();
    return true;
  }
  root.ChoreoCmdkUI={open:open,close:close,isOpen:isOpen};
})(typeof window!=='undefined'?window:globalThis);
