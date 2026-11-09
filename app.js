
const KEY='briefly-articles-v1',SET='briefly-settings-v1',TOKEN_KEY='briefly-read-token-session-v1';
const SYNC_URL='https://briefly-sync.caijuhao50.workers.dev/api/articles';

const sample=`# 全球游戏深度简报｜演示文章

**这是一篇演示文章，不是实时新闻。**

欢迎使用「简报」。这里将来会显示 ChatGPT 定时任务生成的完整文章。

## 舒适阅读

阅读器采用接近苹果系统的白色背景，保留状态栏，并支持字体大小调整。长篇文章使用浏览器原生滚动，避免复杂翻页动画造成的卡顿。

## 内容同步

当前版本支持导入 Markdown、纯文本，以及从已授权的云端读取文章。

| 功能 | 当前状态 |
|---|---|
| 本地阅读 | 已实现 |
| 字号和背景 | 已实现 |
| 文件导入 | 已实现 |
| 云端手动同步 | 已实现 |
| ChatGPT 自动导出 | 尚未接入 |

> 先让阅读体验稳定，再接入自动化。`;

function load(k,d){
  try{return JSON.parse(localStorage.getItem(k))??d}
  catch{return d}
}

let articles=load(KEY,[{
  id:'demo',
  title:'全球游戏深度简报｜演示文章',
  category:'游戏',
  date:'2026-11-09',
  body:sample
}]);

let settings=load(SET,{font:18,theme:'white'});
let page='home',filter='全部',current=null;
let syncStatus='尚未同步',syncBusy=false;
let readToken='';

try{
  readToken=sessionStorage.getItem(TOKEN_KEY)||'';
}catch{}

function save(){
  localStorage.setItem(KEY,JSON.stringify(articles));
  localStorage.setItem(SET,JSON.stringify(settings));
}

function esc(s){
  return String(s??'').replace(/[&<>"']/g,c=>({
    '&':'&amp;','<':'&lt;','>':'&gt;',
    '"':'&quot;',"'":'&#39;'
  }[c]));
}

function inline(s){
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,'<em>$1</em>')
    .replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      (_,label,url)=>{
        const safe=url.replace(/&amp;/g,'&');
        try{
          const u=new URL(safe);
          if(!['http:','https:'].includes(u.protocol)){
            return label;
          }
          return `<a href="${esc(u.href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
        }catch{
          return label;
        }
      }
    );
}

function md(source){
  let lines=String(source??'')
    .replace(/\r\n/g,'\n')
    .split('\n');

  let out=[],para=[],table=[];

  const flush=()=>{
    if(para.length){
      out.push('<p>'+inline(para.join(' '))+'</p>');
      para=[];
    }
  };

  const flushTable=()=>{
    if(table.length){
      out.push(
        '<table>'+
        table.map((r,i)=>
          '<tr>'+
          r.map(x=>
            `<${i?'td':'th'}>${inline(x)}</${i?'td':'th'}>`
          ).join('')+
          '</tr>'
        ).join('')+
        '</table>'
      );
      table=[];
    }
  };

  for(let line of lines){
    if(/^\s*\|.*\|\s*$/.test(line)){
      flush();
      const cells=line.trim()
        .replace(/^\||\|$/g,'')
        .split('|')
        .map(x=>x.trim());

      if(cells.every(x=>/^:?-{3,}:?$/.test(x)))continue;
      table.push(cells);
      continue;
    }

    flushTable();

    if(!line.trim()){
      flush();
      continue;
    }

    if(/^#{1,6}\s/.test(line)){
      flush();
      let n=line.match(/^#+/)[0].length;
      out.push(`<h${n}>${inline(line.slice(n).trim())}</h${n}>`);
    }else if(/^---+$/.test(line.trim())){
      flush();
      out.push('<hr>');
    }else if(/^>\s?/.test(line)){
      flush();
      out.push(
        '<blockquote>'+
        inline(line.replace(/^>\s?/,''))+
        '</blockquote>'
      );
    }else if(/^[-*]\s/.test(line)){
      flush();
      out.push('<p>• '+inline(line.slice(2))+'</p>');
    }else{
      para.push(line);
    }
  }

  flush();
  flushTable();
  return out.join('\n');
}

function setToken(token){
  readToken=token.trim();
  try{
    if(readToken){
      sessionStorage.setItem(TOKEN_KEY,readToken);
    }else{
      sessionStorage.removeItem(TOKEN_KEY);
    }
  }catch{}
}

async function syncCloud(manual=false){
  if(syncBusy)return;

  if(!readToken){
    syncStatus='尚未登录：请在设置中输入阅读密钥';
    if(page!=='reader')render();

    if(manual){
      alert('请先进入设置，输入 READ_TOKEN 的密钥值。');
    }
    return;
  }

  syncBusy=true;
  syncStatus='正在从数据库同步…';
  if(page!=='reader')render();

  try{
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),15000);
    let response;

    try{
      response=await fetch(SYNC_URL,{
        method:'GET',
        headers:{
          'Authorization':'Bearer '+readToken
        },
        cache:'no-store',
        signal:controller.signal,
        mode:'cors'
      });
    }finally{
      clearTimeout(timeout);
    }

    if(response.status===401){
      syncStatus='密钥错误或已失效，请到设置重新登录';
      if(manual)alert(syncStatus);
      return;
    }

    if(!response.ok){
      throw Error('HTTP '+response.status);
    }

    const data=await response.json();

    if(!data||!Array.isArray(data.articles)){
      throw Error('文章数据格式不正确');
    }

    let count=0;

    for(const item of data.articles){
      if(
        !item||
        typeof item.id!=='string'||
        typeof item.title!=='string'||
        typeof item.content!=='string'||
        item.content.length>1500000
      )continue;

      const id='cloud:'+item.id;

      const article={
        id,
        title:item.title,
        category:typeof item.category==='string'
          ?item.category:'导入',
        date:typeof item.date==='string'?item.date:'',
        body:item.content
      };

      const index=articles.findIndex(a=>a.id===id);

      if(index<0){
        articles.unshift(article);
        count++;
      }else if(
        articles[index].body!==article.body||
        articles[index].title!==article.title||
        articles[index].category!==article.category||
        articles[index].date!==article.date
      ){
        articles[index]=article;
        count++;
      }
    }

    save();

    syncStatus=count
      ?'已同步 '+count+' 篇新或更新的文章'
      :'云端已是最新';

  }catch(err){
    syncStatus='同步失败：'+(
      err.name==='AbortError'
        ?'连接超时'
        :err.message||'网络异常'
    );

    if(manual){
      alert(syncStatus+'。本地文章仍可正常阅读。');
    }
  }finally{
    syncBusy=false;
    if(page!=='reader')render();
  }
}

const root=document.getElementById('root');

function nav(){
  return `<nav class="nav">
    <div class="nav-inner">
      <button class="${page==='home'?'on':''}" data-page="home">
        <span>⌂</span>首页
      </button>
      <button class="${page==='library'?'on':''}" data-page="library">
        <span>▤</span>文章
      </button>
      <button class="${page==='settings'?'on':''}" data-page="settings">
        <span>⚙</span>设置
      </button>
    </div>
  </nav>`;
}

function render(){
  document.body.className=
    page==='reader'?'reader '+settings.theme:'';

  if(page==='reader'){
    const a=articles.find(x=>x.id===current);

    if(!a){
      page='home';
      return render();
    }

    root.innerHTML=`<main class="app">
      <header class="reader-head">
        <button class="plain" id="back">〈 返回</button>
        <span class="eyebrow">
          ${esc(a.category)} · ${esc(a.date)}
        </span>
        <button class="plain" id="font">Aa</button>
      </header>
      <article class="reading" style="font-size:${settings.font}px">
        ${md(a.body)}
      </article>
    </main>`;

    document.getElementById('back').onclick=()=>{
      page='library';
      render();
    };

    document.getElementById('font').onclick=()=>{
      page='settings';
      render();
    };

    return;
  }

  if(page==='settings'){
    root.innerHTML=`<main class="app">
      <div class="top">
        <div>
          <div class="eyebrow">个人偏好</div>
          <h1 class="title">设置</h1>
        </div>
      </div>

      <section class="settings">
        <div class="setting">
          <label for="fontSize">
            阅读字号 <b id="sizeText">${settings.font}px</b>
          </label>
          <input id="fontSize" type="range"
            min="14" max="28" value="${settings.font}">
        </div>

        <div class="setting">
          <label for="theme">阅读背景</label>
          <select id="theme">
            <option value="white">苹果白</option>
            <option value="sepia">暖纸色</option>
            <option value="dark">深色</option>
          </select>
        </div>
      </section>

      <section class="settings" style="margin-top:16px">
        <div class="setting" style="display:block">
          <label for="readToken">
            云端阅读密钥（READ_TOKEN）
          </label>

          <input id="readToken"
            type="password"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            placeholder="粘贴密钥值，不是 READ_TOKEN 这几个字"
            style="display:block;width:100%;box-sizing:border-box;
            margin-top:12px;padding:12px;border:1px solid #bbb;
            border-radius:10px;font-size:16px">

          <p class="muted">
            ${readToken
              ?'本次会话已保存阅读密钥'
              :'尚未登录云端'}。
            密钥不会上传到 GitHub，也不会写入永久本地存储；
            浏览器会话结束后可能需要重新输入。
          </p>

          <div class="actions">
            <button class="primary" id="saveToken">
              保存密钥并同步
            </button>
            <button class="secondary" id="logout">
              清除阅读密钥
            </button>
          </div>
        </div>
      </section>

      <div class="actions">
        <button class="secondary" id="syncNow">
          立即同步云端
        </button>
        <button class="primary" id="import">
          导入 Markdown / TXT
        </button>
        <input type="file" id="file"
          accept=".md,.markdown,.txt,text/plain,text/markdown"
          hidden>
      </div>

      <p class="muted" id="syncState">
        ${esc(syncStatus)}
      </p>

      <p class="muted">
        文章缓存在当前浏览器本地。
        清除网站数据可能删除文章，请保留原文件。
        当前仅实现从 Cloudflare D1 读取，
        尚未接入 ChatGPT 定时任务自动导出。
      </p>
    </main>${nav()}`;

    document.getElementById('theme').value=settings.theme;

    document.getElementById('fontSize').oninput=e=>{
      settings.font=+e.target.value;
      document.getElementById('sizeText').textContent=
        settings.font+'px';
      save();
    };

    document.getElementById('theme').onchange=e=>{
      settings.theme=e.target.value;
      save();
    };

    document.getElementById('saveToken').onclick=()=>{
      const token=document.getElementById('readToken').value.trim();

      if(!token){
        alert('请先粘贴阅读密钥');
        return;
      }

      setToken(token);
      syncCloud(true);
    };

    document.getElementById('logout').onclick=()=>{
      setToken('');
      syncStatus='已清除阅读密钥（已下载的文章仍保留）';
      render();
    };

    document.getElementById('syncNow').onclick=()=>syncCloud(true);

    document.getElementById('import').onclick=()=>{
      document.getElementById('file').click();
    };

    document.getElementById('file').onchange=async e=>{
      const f=e.target.files[0];
      if(!f)return;

      const body=await f.text();

      if(body.length>1500000){
        alert('文件过大，请选择 1.5 MB 以下的文本文件');
        return;
      }

      const title=body.match(/^#\s+(.+)/m)?.[1]||
        f.name.replace(/\.(md|markdown|txt)$/i,'');

      articles.unshift({
        id:Date.now().toString(36),
        title,
        category:'导入',
        date:new Date().toLocaleDateString('zh-CN'),
        body
      });

      try{
        save();
        page='library';
        render();
      }catch{
        articles.shift();
        alert('本地存储空间不足，导入失败');
      }
    };

    bindNav();
    return;
  }

  const cats=[
    '全部','游戏','文化阅读','公务员','EDM','导入'
  ];

  const visible=articles.filter(
    a=>filter==='全部'||a.category===filter
  );

  root.innerHTML=`<main class="app">
    <div class="top">
      <div>
        <div class="eyebrow">
          ${new Date().toLocaleDateString('zh-CN',{
            year:'numeric',
            month:'long',
            day:'numeric',
            weekday:'long'
          })}
        </div>
        <h1 class="title">
          ${page==='home'?'今天读什么？':'全部简报'}
        </h1>
      </div>
      <button class="round" id="gear" aria-label="设置">
        ⚙
      </button>
    </div>

    <div class="muted" style="margin-bottom:10px">
      ${esc(syncStatus)}
      <button class="plain" id="syncInline"
        style="margin-left:10px">
        ↻ 同步
      </button>
    </div>

    <div class="filters">
      ${cats.map(c=>`
        <button class="chip ${c===filter?'active':''}"
          data-cat="${esc(c)}">
          ${esc(c)}
        </button>
      `).join('')}
    </div>

    ${visible.length
      ?visible.map(a=>`
        <button class="article" data-id="${esc(a.id)}">
          <span class="category">${esc(a.category)}</span>
          <h2>${esc(a.title)}</h2>
          <p>${esc(a.body.replace(/[#*|>\n]/g,' ').slice(0,95))}…</p>
          <div class="meta">
            ${esc(a.date)} · 点击阅读
          </div>
        </button>
      `).join('')
      :`<div class="empty">
        这里还没有文章。
        可前往设置导入 Markdown 文件。
      </div>`
    }
  </main>${nav()}`;

  document.getElementById('syncInline').onclick=()=>syncCloud(true);

  document.getElementById('gear').onclick=()=>{
    page='settings';
    render();
  };

  document.querySelectorAll('[data-cat]').forEach(el=>{
    el.onclick=()=>{
      filter=el.dataset.cat;
      render();
    };
  });

  document.querySelectorAll('[data-id]').forEach(el=>{
    el.onclick=()=>{
      current=el.dataset.id;
      page='reader';
      render();
      window.scrollTo(0,0);
    };
  });

  bindNav();
}

function bindNav(){
  document.querySelectorAll('[data-page]').forEach(el=>{
    el.onclick=()=>{
      page=el.dataset.page;
      render();
      window.scrollTo(0,0);
    };
  });
}

render();

if('serviceWorker'in navigator&&location.protocol.startsWith('http')){
  navigator.serviceWorker.register('./sw.js').catch(()=>{});
}

if(readToken)syncCloud(false);

document.addEventListener('visibilitychange',()=>{
  if(!document.hidden&&readToken)syncCloud(false);
});
