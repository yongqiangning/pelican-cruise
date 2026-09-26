/* 新标签页的桌面层：时钟（带农历）、搜索框、快捷网址。
   只在插件产物里跑 —— build.mjs 把 home.html 注入 newtab.html，这个文件跟着复制过去，
   游戏版和桌面壁纸版完全没有这一段。
   数据（网址、搜索引擎、收起状态）全存在扩展自己的 localStorage 里；
   唯一的对外请求是浏览器自己按 <img> 去目标站点取 favicon.ico，取不到就退回名称首字色块。 */
(() => {
  const CFG = window.__PELICAN_WP || {};
  if (!CFG.home) return; // 配置里关掉了，整个桌面层不启动

  const root = document.documentElement;
  const $ = (sel, scope = document) => scope.querySelector(sel);

  const KEY = {
    sites: 'pelican.home.sites',
    engine: 'pelican.home.engine',
    hidden: 'pelican.home.hidden',
  };
  const read = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  };
  const write = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {}
  };

  // ---------------- 搜索引擎 ----------------
  const ENGINES = [
    { id: 'bing', name: '必应', url: 'https://www.bing.com/search?q=', mark: 'b', color: '#1180d4' },
    { id: 'baidu', name: '百度', url: 'https://www.baidu.com/s?wd=', mark: '百', color: '#2a35e0' },
    { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=', mark: 'G', color: '#4285f4' },
    { id: 'sogou', name: '搜狗', url: 'https://www.sogou.com/web?query=', mark: '搜', color: '#ff6a00' },
    { id: 'zhihu', name: '知乎', url: 'https://www.zhihu.com/search?type=content&q=', mark: '知', color: '#0084ff' },
    { id: 'bilibili', name: 'B 站', url: 'https://search.bilibili.com/all?keyword=', mark: 'B', color: '#fb7299' },
  ];

  // 第一次打开时给一批常用站点，之后完全由用户增删（删光了也不会自己长回来）
  // hi = 该站官方高清图标（首页 <link rel="apple-touch-icon"> 里抄出来的），/favicon.ico 只有 16~32px，放大就糊
  const DEFAULT_SITES = [
    { name: '百度', url: 'https://www.baidu.com', hi: 'https://psstatic.cdn.bcebos.com/video/wiseindex/aa6eef91f8b5b1a33b454c401_1660835115000.png' },
    { name: 'B 站', url: 'https://www.bilibili.com', hi: 'https://i0.hdslb.com/bfs/static/jinkela/long/images/512.png' },
    { name: '知乎', url: 'https://www.zhihu.com' },
    { name: '小红书', url: 'https://www.xiaohongshu.com' },
    { name: '淘宝', url: 'https://www.taobao.com' },
    { name: '微博', url: 'https://weibo.com' },
    { name: '抖音', url: 'https://www.douyin.com' },
    { name: '豆瓣', url: 'https://www.douban.com' },
    { name: 'GitHub', url: 'https://github.com' },
    { name: 'YouTube', url: 'https://www.youtube.com', hi: 'https://www.youtube.com/img/favicon_144x144.png' },
    { name: 'DeepSeek', url: 'https://chat.deepseek.com', hi: 'https://fe-static.deepseek.com/chat/icon-180.png' },
    { name: '通义千问', url: 'https://tongyi.aliyun.com' },
  ];

  const ICON = {
    edit: '<svg viewBox="0 0 24 24" fill="none"><path d="M4.6 19.4l4.3-.9L19.3 8a1.7 1.7 0 0 0 0-2.4l-.9-.9a1.7 1.7 0 0 0-2.4 0L5.5 15.1l-.9 4.3Z" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>',
    del: '<svg viewBox="0 0 24 24" fill="none"><path d="M6.6 6.6 17.4 17.4M17.4 6.6 6.6 17.4" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 5.4v13.2M5.4 12h13.2" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  };

  const hostOf = (url) => {
    try {
      return new URL(url).hostname;
    } catch (e) {
      return '';
    }
  };
  const hueOf = (text) => {
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
    return h;
  };

  // ---------------- 时钟与农历 ----------------
  const WEEK = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  const cnDay = (n) =>
    n <= 10 ? `初${CN[n - 1]}` : n < 20 ? `十${CN[n - 11]}` : n === 20 ? '二十' : n < 30 ? `二十${CN[n - 21]}` : '三十';

  // 农历交给浏览器内置的中国历法，不自己塞一张几十年的月相表
  let lunarFmt = null;
  try {
    const f = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'long', day: 'numeric' });
    if (f.resolvedOptions().calendar === 'chinese') lunarFmt = f;
  } catch (e) {}

  function lunarText(date) {
    if (!lunarFmt) return '';
    try {
      let month = '';
      let day = '';
      for (const part of lunarFmt.formatToParts(date)) {
        if (part.type === 'month') month = part.value;
        else if (part.type === 'day') day = part.value;
      }
      if (!month) return '';
      const n = parseInt(day, 10);
      return Number.isFinite(n) ? month + cnDay(n) : month + day;
    } catch (e) {
      return '';
    }
  }

  const timeEl = $('#homeTime');
  const dateEl = $('#homeDate');
  let lastDayKey = -1;

  function paintClock(now) {
    timeEl.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const dayKey = now.getFullYear() * 10000 + now.getMonth() * 100 + now.getDate();
    if (dayKey === lastDayKey) return;
    lastDayKey = dayKey;
    const lunar = lunarText(now);
    dateEl.textContent =
      `${now.getMonth() + 1}月${now.getDate()}日\u3000${WEEK[now.getDay()]}` + (lunar ? `\u3000${lunar}` : '');
  }
  function tick() {
    const now = new Date();
    paintClock(now);
    setTimeout(tick, 1000 - now.getMilliseconds() + 20);
  }
  // 切走再切回来（新标签页很容易被丢在后台）时，立刻把时间对回来，别等下一秒
  addEventListener('focus', () => paintClock(new Date()));
  addEventListener('visibilitychange', () => {
    if (!document.hidden) paintClock(new Date());
  });

  // ---------------- 搜索 ----------------
  const searchForm = $('#homeSearch');
  const input = $('#homeQuery');
  const engineBtn = $('#homeEngine');
  const engineMenu = $('#homeEngineMenu');
  let engine = ENGINES.find((e) => e.id === read(KEY.engine, 'bing')) || ENGINES[0];

  function markNode(item, cls) {
    const mark = document.createElement('span');
    mark.className = cls;
    mark.textContent = item.mark;
    mark.style.background = item.color;
    return mark;
  }
  function paintEngine() {
    engineBtn.textContent = '';
    engineBtn.appendChild(markNode(engine, 'mark'));
    engineBtn.title = `搜索引擎：${engine.name}（点击切换）`;
  }
  function paintEngineMenu() {
    engineMenu.textContent = '';
    for (const item of ENGINES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = item.id === engine.id ? 'on' : '';
      btn.appendChild(markNode(item, 'mark'));
      btn.appendChild(document.createTextNode(item.name));
      btn.addEventListener('click', () => {
        engine = item;
        write(KEY.engine, item.id);
        paintEngine();
        paintEngineMenu();
        hideEngineMenu();
        input.focus();
      });
      engineMenu.appendChild(btn);
    }
  }
  const showEngineMenu = () => {
    paintEngineMenu();
    engineMenu.hidden = false;
    engineBtn.setAttribute('aria-expanded', 'true');
  };
  const hideEngineMenu = () => {
    engineMenu.hidden = true;
    engineBtn.setAttribute('aria-expanded', 'false');
  };
  engineBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (engineMenu.hidden) showEngineMenu();
    else hideEngineMenu();
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest?.('#homeSearch')) hideEngineMenu();
  });

  const normalizeUrl = (raw) => (/^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`);
  // 看着像网址就直接打开，否则拿当前引擎搜（含 http://、localhost:3000、a.b.com/path 这几种）
  const URL_LIKE = /^(?:https?:\/\/|localhost(?::\d+)?(?:[/?#]|$)|[\w-]+(?:\.[\w-]+)+(?::\d+)?(?:[/?#]\S*)?$)/i;
  function navigate(text) {
    const value = String(text || '').trim();
    if (!value) return;
    const target = /^https?:\/\//i.test(value)
      ? value
      : URL_LIKE.test(value) && !/\s/.test(value)
        ? `https://${value}`
        : engine.url + encodeURIComponent(value);
    location.href = target;
  }
  searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    navigate(input.value);
  });

  // ---------------- 快捷网址 ----------------
  const wrap = $('#homeSites');
  const undoBar = $('#homeUndo');
  const undoText = $('#homeUndo .uo-text');

  let sites = read(KEY.sites, null);
  const firstRun = !Array.isArray(sites);
  if (firstRun) {
    sites = DEFAULT_SITES.map((s) => ({ ...s }));
  } else {
    // 老用户升级：按 URL 给存量站点补默认站点新加的 hi 字段（只补缺，不动用户数据）
    const hiByUrl = new Map(DEFAULT_SITES.filter((s) => s.hi).map((s) => [s.url.replace(/\/+$/, ''), s.hi]));
    for (const s of sites) {
      if (s && !s.hi && !String(s.icon || '').trim()) {
        const hi = hiByUrl.get(String(s.url || '').replace(/\/+$/, ''));
        if (hi) s.hi = hi;
      }
    }
  }
  let dragEl = null;
  let undoTimer = 0;
  let undoSite = null;

  function iconSources(site) {
    const out = [];
    const icon = String(site.icon || '').trim();
    if (icon && /^(?:https?:|data:)/i.test(icon)) out.push(icon);
    // 手动设置的 icon 优先，其次默认站点自带的高清图，再往下按固定路径探测
    else if (site.hi) out.push(site.hi);
    const host = hostOf(site.url);
    if (host) {
      // apple-touch-icon 一般 180x180 起步，比 favicon.ico（16/32px）清晰得多
      out.push(`https://${host}/apple-touch-icon.png`);
      out.push(`https://${host}/apple-touch-icon-precomposed.png`);
      out.push(`https://${host}/favicon.ico`);
    }
    return out;
  }
  function paintIcon(box, site) {
    box.textContent = '';
    box.style.background = '';
    const icon = String(site.icon || '').trim();
    if (icon && !/^(?:https?:|data:)/i.test(icon)) {
      // 直接写了 emoji / 单个字
      const span = document.createElement('span');
      span.className = 's-emoji';
      span.textContent = icon;
      box.appendChild(span);
      return;
    }
    const srcs = iconSources(site);
    if (!srcs.length) return paintLetter(box, site);
    let i = 0;
    const tryNext = () => {
      const src = srcs[i++];
      if (!src) return paintLetter(box, site);
      const img = new Image();
      img.alt = '';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      img.style.visibility = 'hidden'; // 加载好再露面，免得先闪一个破图
      img.addEventListener('load', () => {
        box.textContent = '';
        box.style.background = '';
        img.style.visibility = 'visible';
        box.appendChild(img);
      });
      img.addEventListener('error', tryNext);
      img.src = src;
    };
    tryNext();
  }
  function paintLetter(box, site) {
    box.textContent = '';
    const seed = hostOf(site.url) || site.name || '';
    box.style.background = `hsl(${hueOf(seed)} 50% 42%)`;
    const span = document.createElement('span');
    span.className = 's-letter';
    span.textContent = ([...(site.name || seed || '?')][0] || '?').toUpperCase();
    box.appendChild(span);
  }

  function toolButton(kind, title, svg) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = kind;
    btn.title = title;
    btn.tabIndex = -1;
    btn.innerHTML = svg;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const index = Number(btn.closest('.site').dataset.idx);
      if (kind === 'del') dropSite(index);
      else openDialog(index);
    });
    return btn;
  }

  function makeSite(site, index) {
    const link = document.createElement('a');
    link.className = 'site';
    link.href = site.url;
    link.draggable = true;
    link.dataset.idx = String(index);
    link.title = `${site.name}\n${site.url}`;

    const box = document.createElement('div');
    box.className = 's-ico';
    paintIcon(box, site);
    link.appendChild(box);

    const name = document.createElement('span');
    name.className = 's-name';
    name.textContent = site.name;
    link.appendChild(name);

    const tools = document.createElement('div');
    tools.className = 's-tools';
    tools.appendChild(toolButton('edit', '编辑', ICON.edit));
    tools.appendChild(toolButton('del', '删除', ICON.del));
    link.appendChild(tools);
    return link;
  }

  function makeAdd() {
    const link = document.createElement('a');
    link.className = 'site site-add';
    link.href = '#';
    link.title = '添加快捷网址';
    const box = document.createElement('div');
    box.className = 's-ico';
    box.innerHTML = ICON.plus;
    link.appendChild(box);
    const name = document.createElement('span');
    name.className = 's-name';
    name.textContent = '添加';
    link.appendChild(name);
    link.addEventListener('click', (e) => {
      e.preventDefault();
      openDialog(-1);
    });
    return link;
  }

  function render() {
    wrap.textContent = '';
    if (!sites.length) {
      const empty = document.createElement('div');
      empty.className = 'site-empty';
      empty.textContent = '还没有快捷网址，点下面的 + 添加一个';
      wrap.appendChild(empty);
    }
    sites.forEach((site, i) => wrap.appendChild(makeSite(site, i)));
    wrap.appendChild(makeAdd());
  }

  function hideUndo() {
    clearTimeout(undoTimer);
    undoSite = null;
    undoBar.hidden = true;
  }
  function dropSite(index) {
    const site = sites[index];
    if (!site) return;
    sites = sites.filter((_, i) => i !== index);
    write(KEY.sites, sites);
    render();
    clearTimeout(undoTimer);
    undoSite = { site, index };
    undoText.textContent = `已删除「${site.name}」`;
    undoBar.hidden = false;
    undoTimer = setTimeout(hideUndo, 8000);
  }
  const undoBtn = $('#homeUndoBtn');
  if (undoBtn) {
    undoBtn.addEventListener('click', () => {
      if (!undoSite) return hideUndo();
      const next = sites.slice();
      next.splice(Math.min(undoSite.index, next.length), 0, undoSite.site);
      sites = next;
      write(KEY.sites, sites);
      hideUndo();
      render();
    });
  }

  // ---------------- 添加 / 编辑弹窗 ----------------
  const dialog = $('#homeDialog');
  const dialogForm = $('#homeForm');
  let editingIndex = -1;

  function openDialog(index) {
    editingIndex = index;
    const site = index >= 0 ? sites[index] : null;
    $('#hdTitle').textContent = site ? '编辑快捷网址' : '添加快捷网址';
    $('#hdName').value = site ? site.name : '';
    $('#hdUrl').value = site ? site.url : '';
    $('#hdIcon').value = site ? site.icon || '' : '';
    dialog.hidden = false;
    setTimeout(() => $('#hdName').focus(), 30);
  }
  function closeDialog() {
    dialog.hidden = true;
    editingIndex = -1;
  }
  $('#hdCancel').addEventListener('click', closeDialog);
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) closeDialog();
  });
  dialogForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const rawUrl = $('#hdUrl').value.trim();
    if (!rawUrl) return $('#hdUrl').focus();
    const url = normalizeUrl(rawUrl);
    const name = $('#hdName').value.trim() || hostOf(url) || rawUrl;
    const icon = $('#hdIcon').value.trim();
    const item = { name, url };
    if (icon) item.icon = icon;
    sites = editingIndex < 0 ? [...sites, item] : sites.map((s, i) => (i === editingIndex ? item : s));
    write(KEY.sites, sites);
    closeDialog();
    render();
    wrap.scrollTop = wrap.scrollHeight;
  });

  // ---------------- 拖拽排序 ----------------
  function nearestSpot(x, y) {
    let best = null;
    let bestDist = Infinity;
    let before = true;
    for (const el of wrap.querySelectorAll('.site:not(.site-add):not(.dragging)')) {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dist = (x - cx) ** 2 + (y - cy) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        best = el;
        before = x < cx; // 落在格子左半边就插到它前面
      }
    }
    return best ? { el: best, before } : null;
  }
  wrap.addEventListener('dragstart', (e) => {
    const el = e.target.closest?.('.site');
    if (!el || el.classList.contains('site-add')) {
      e.preventDefault();
      return;
    }
    dragEl = el;
    el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', sites[Number(el.dataset.idx)]?.url || '');
    } catch (err) {}
  });
  wrap.addEventListener('dragover', (e) => {
    if (!dragEl) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const spot = nearestSpot(e.clientX, e.clientY);
    if (!spot) return;
    wrap.insertBefore(dragEl, spot.before ? spot.el : spot.el.nextSibling);
  });
  wrap.addEventListener('drop', (e) => {
    if (dragEl) e.preventDefault();
  });
  wrap.addEventListener('dragend', () => {
    if (!dragEl) return;
    dragEl.classList.remove('dragging');
    dragEl = null;
    const order = [...wrap.querySelectorAll('.site:not(.site-add)')].map((el) => Number(el.dataset.idx));
    if (order.length !== sites.length) return;
    sites = order.map((i) => sites[i]);
    write(KEY.sites, sites);
    render();
  });

  // ---------------- 右上角的树叶：收起 / 展开 ----------------
  const leaf = $('#homeLeaf');
  const setHidden = (off) => {
    root.classList.toggle('home-off', off);
    leaf.setAttribute('aria-pressed', String(off));
    leaf.title = off ? '展开「时间 · 搜索 · 快捷网址」（快捷键 L）' : '收起「时间 · 搜索 · 快捷网址」（快捷键 L）';
    write(KEY.hidden, off);
  };
  leaf.addEventListener('click', () => {
    const off = !root.classList.contains('home-off');
    setHidden(off);
    if (off) {
      closeDialog();
      hideEngineMenu();
      input.blur();
    }
  });
  leaf.setAttribute('aria-pressed', String(root.classList.contains('home-off')));

  // ---------------- 快捷键 ----------------
  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t?.isContentEditable;
    if (e.key === 'Escape') {
      if (!dialog.hidden) closeDialog();
      else if (!engineMenu.hidden) hideEngineMenu();
      else if (typing) t.blur();
      return;
    }
    if (typing) return;
    if (e.key === 'l' || e.key === 'L') {
      e.preventDefault();
      leaf.click();
    } else if (e.key === '/' && !root.classList.contains('home-off')) {
      e.preventDefault();
      input.focus();
    }
  });

  // ---------------- 启动 ----------------
  // 底部控制条占多高不固定（窗口一窄就折行），量出来交给 CSS，
  // 撤销条和图标网格才知道该往上让多少
  const npbar = document.querySelector('#npbar');
  if (npbar && typeof ResizeObserver === 'function') {
    const measure = () => {
      const h = Math.round(npbar.getBoundingClientRect().height);
      root.style.setProperty('--npbar-h', `${h}px`);
    };
    new ResizeObserver(measure).observe(npbar);
    measure();
  }

  paintEngine();
  paintEngineMenu();
  if (firstRun) write(KEY.sites, sites);
  render();
  tick();
})();
