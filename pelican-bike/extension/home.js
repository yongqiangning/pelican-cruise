/* 新标签页的桌面层：时钟（带农历）、搜索框、快捷网址。
   只在插件产物里跑 —— build.mjs 把 home.html 注入 newtab.html，这个文件跟着复制过去，
   游戏版和桌面壁纸版完全没有这一段。
   数据（网址、搜索引擎、收起状态）全存在扩展自己的 localStorage 里；
   对外请求只有两处，都不经过第三方：按 <img> 去目标站点试几组常见图标路径（见下面的图标解析），
   以及用户主动点了「查找高清图标」并授权之后，抓一次该站点自己的首页 HTML 找它声明的图标。 */
(() => {
  const CFG = window.__PELICAN_WP || {};
  if (!CFG.home) return; // 配置里关掉了，整个桌面层不启动

  const root = document.documentElement;
  const $ = (sel, scope = document) => scope.querySelector(sel);

  const KEY = {
    sites: 'pelican.home.sites',
    engine: 'pelican.home.engine',
    hidden: 'pelican.home.hidden',
    iconCache: 'pelican.home.iconcache',
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
  // hi = 该站官方高清图标，从它首页 <link rel="apple-touch-icon"> 里抄出来的（/favicon.ico 只有 16~32px，放大就糊）。
  // 只放实测能取到的；地址失效也不要紧 —— resolveIcon 会丢掉它、重新按下面的规则找一遍。
  const DEFAULT_SITES = [
    { name: '百度', url: 'https://www.baidu.com', hi: 'https://psstatic.cdn.bcebos.com/video/wiseindex/aa6eef91f8b5b1a33b454c401_1660835115000.png' },
    { name: 'B 站', url: 'https://www.bilibili.com', hi: 'https://i0.hdslb.com/bfs/static/jinkela/long/images/512.png' },
    { name: '知乎', url: 'https://www.zhihu.com', hi: 'https://static.zhihu.com/heifetz/assets/apple-touch-icon-152.81060cab.png' },
    { name: '小红书', url: 'https://www.xiaohongshu.com', hi: 'https://picasso-static.xiaohongshu.com/fe-platform/f43dc4a8baf03678996c62d8db6ebc01a82256ff.png' },
    { name: '淘宝', url: 'https://www.taobao.com', hi: 'https://img.alicdn.com/tps/i3/T1OjaVFl4dXXa.JOZB-114-114.png' },
    { name: '微博', url: 'https://weibo.com' },
    { name: '抖音', url: 'https://www.douyin.com' },
    { name: '豆瓣', url: 'https://www.douban.com' },
    { name: 'GitHub', url: 'https://github.com', hi: 'https://github.com/apple-touch-icon.png' },
    { name: 'YouTube', url: 'https://www.youtube.com', hi: 'https://www.youtube.com/img/favicon_144x144.png' },
    { name: 'DeepSeek', url: 'https://chat.deepseek.com', hi: 'https://fe-static.deepseek.com/chat/icon-180.png' },
    { name: '通义千问', url: 'https://tongyi.aliyun.com', hi: 'https://img.alicdn.com/imgextra/i4/O1CN01Qd3F9s1ilWmLJo56P_!!6000000004453-55-tps-51-51.svg' },
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

  // ---------------- 图标解析：尽量拿到最清晰的那张 ----------------
  /* 图标位是 58px（视网膜屏按 116px 渲染），而站点根目录的 favicon.ico 往往只有 16~32px，放大就糊。
     所以按四级依次找，拿到 ≥180px 就收手：

       1. 用户手动填的图标 —— 原样用，不猜
       2. 记录里的 hi —— 默认站点自带的高清地址，或上一次查到的结果
       3. 本地缓存（按 host 存；查到 30 天、查无 6 小时内不重复探测）
       4. 猜站点根目录下的常见路径（apple-touch-icon 系 / PWA 图标 / favicon.svg）；
          还是没到 180px 就抓一次首页 HTML，读它自己声明的图标地址（含 manifest.json 里的 PWA 图标）。
          这一级要「读取网页」的可选权限，没授权就跳过，其余三级照跑

     ★ 关键：每级都是「全部并排加载完再比像素」，不是「谁先成功用谁」。按顺序试第一个成功的写法，
     会让 32px 的 favicon.ico 抢在 180px 的 apple-touch-icon.png 前面——这正是图标糊的老原因。
     实在挑不出来才退回首字色块。 */
  const ICON_GOOD = 180; // 长边到这个数就算高清，不必再往下找
  const CACHE_OK_TTL = 30 * 864e5; // 查到结果缓存 30 天
  const CACHE_FAIL_TTL = 6 * 36e5; // 查无结果只压 6 小时（站点也可能只是暂时抽风）
  const IMG_TIMEOUT = 6000;
  // 先试最可能大的那批；一个都没到 180 再试剩下的小尺寸兜底
  const ICON_PATHS_HI = [
    '/apple-touch-icon.png',
    '/apple-touch-icon-precomposed.png',
    '/apple-touch-icon-180x180.png',
    '/apple-touch-icon-167x167.png',
    '/apple-touch-icon-152x152.png',
    '/apple-touch-icon-120x120.png',
    '/favicon.svg',
    '/android-chrome-512x512.png',
    '/android-chrome-192x192.png',
    '/favicon-196x196.png',
    '/favicon-192x192.png',
  ];
  const ICON_PATHS_LO = [
    '/mstile-150x150.png',
    '/apple-touch-icon-114x114.png',
    '/apple-touch-icon-76x76.png',
    '/favicon-96x96.png',
    '/favicon-64x64.png',
    '/favicon-48x48.png',
    '/favicon-32x32.png',
    '/favicon-16x16.png',
    '/favicon.ico',
  ];

  const iconCache = read(KEY.iconCache, {}) || {};
  const saveIconCache = () => write(KEY.iconCache, iconCache);

  // 同时最多解析几个站点的图标（默认站点一次要解析十几个，不排队会一口气甩出上百个请求）
  const makeLimiter = (n) => {
    let active = 0;
    const queue = [];
    const pump = () => {
      while (active < n && queue.length) {
        active++;
        const task = queue.shift();
        task().then(
          (v) => { active--; pump(); return v; },
          () => { active--; pump(); },
        );
      }
    };
    return (task) =>
      new Promise((resolve, reject) => {
        queue.push(() => task().then(resolve, reject));
        pump();
      });
  };
  const iconLimiter = makeLimiter(3);

  function loadImage(url, timeout = IMG_TIMEOUT) {
    return new Promise((resolve) => {
      if (!url) return resolve(null);
      const img = new Image();
      let settled = false;
      const done = (v) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        img.onload = null;
        img.onerror = null;
        resolve(v);
      };
      const timer = setTimeout(() => done(null), timeout);
      img.referrerPolicy = 'no-referrer';
      img.decoding = 'async';
      img.onload = () => done({ url, w: img.naturalWidth || 0, h: img.naturalHeight || 0 });
      img.onerror = () => done(null);
      img.src = url;
    });
  }

  // SVG 是矢量，多大都不糊；位图按长边算。
  // 横宽比离谱的（社交分享大图之类）直接算 0 分——方框里按 cover 裁出来会是一块莫名其妙的东西。
  function scoreOf(hit) {
    if (!hit) return -1;
    if (/\.svg(?:[?#]|$)/i.test(hit.url)) return 4096;
    const w = hit.w || 0;
    const h = hit.h || 0;
    if (w && h && (w / h > 2.2 || h / w > 2.2)) return 0;
    return Math.max(w, h);
  }
  const betterOf = (a, b) => (scoreOf(b) > scoreOf(a) ? b : a);

  async function bestOf(urls) {
    if (!urls || !urls.length) return null;
    const hits = (await Promise.all(urls.map((u) => loadImage(u)))).filter(Boolean);
    let best = null;
    let bestScore = 0;
    // 并排试完之后按分数挑；同分保留顺序靠前的（顺序本身就是我们心里的优先级）
    for (const hit of hits) {
      const s = scoreOf(hit);
      if (s > bestScore) {
        best = hit;
        bestScore = s;
      }
    }
    return best;
  }

  // ---- 可选权限：允许之后才能抓首页 HTML（fetch 会跳过 CORS），否则这一级直接跳过 ----
  let pagePerm = false;
  const hasPagePermission = async () => {
    try {
      if (!chrome?.permissions?.contains) return false;
      return !!(await chrome.permissions.contains({ origins: ['<all_urls>'] }));
    } catch (e) {
      return false;
    }
  };
  // 注意：这个必须在用户点击的那一次事件里直接调用，中间 await 过别的东西就会失效
  const askPagePermission = () => {
    try {
      if (!chrome?.permissions?.request) return Promise.resolve(false);
      return chrome.permissions.request({ origins: ['<all_urls>'] }).catch(() => false);
    } catch (e) {
      return Promise.resolve(false);
    }
  };
  hasPagePermission().then((v) => { pagePerm = v; });

  const sizeOf = (sizes) => {
    const m = String(sizes || '').match(/(\d+)\s*[x×]\s*(\d+)/);
    return m ? Math.max(Number(m[1]), Number(m[2])) : 0;
  };

  async function fetchText(url, timeout = 8000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { credentials: 'omit', signal: ctrl.signal });
      return res.ok ? await res.text() : '';
    } catch (e) {
      return '';
    } finally {
      clearTimeout(timer);
    }
  }

  // 从首页 HTML 里把站点自己声明过的图标地址都捞出来（含 PWA manifest 里的），按声明尺寸从大到小排
  async function declaredIconUrls(pageUrl) {
    const html = await fetchText(pageUrl);
    if (!html) return [];
    const doc = new DOMParser().parseFromString(html, 'text/html');
    let base = pageUrl;
    try {
      base = new URL(doc.querySelector('base[href]')?.getAttribute('href') || '', pageUrl).href || pageUrl;
    } catch (e) {}
    const cands = [];
    const push = (raw, size, rank, from = base) => {
      try {
        cands.push({ url: new URL(raw, from).href, size: size || 0, rank });
      } catch (e) {} // 相对地址畸形就跳过这一条
    };
    const manifests = [];
    for (const el of doc.querySelectorAll('link[href]')) {
      const rel = (el.getAttribute('rel') || '').toLowerCase();
      const raw = el.getAttribute('href');
      const size = sizeOf(el.getAttribute('sizes'));
      if (rel.includes('apple-touch-icon')) push(raw, size || 180, 0);
      else if (rel.includes('manifest')) manifests.push(raw);
      else if (rel.split(/\s+/).includes('icon') || rel.includes('shortcut')) push(raw, size, 1);
    }
    for (const el of manifests.slice(0, 2)) {
      try {
        const manUrl = new URL(el, base).href;
        const json = JSON.parse(await fetchText(manUrl));
        for (const ic of json.icons || []) if (ic?.src) push(ic.src, sizeOf(ic.sizes), 0, manUrl);
      } catch (e) {}
    }
    const tile = doc.querySelector('meta[name="msapplication-TileImage"]');
    if (tile) push(tile.getAttribute('content'), 144, 2);
    // 最后一手：社交分享大图。往往是横图会被裁，但总比首字色块强，所以排最后
    const og = doc.querySelector('meta[property="og:image"], meta[name="og:image"]');
    if (og) push(og.getAttribute('content'), 200, 9);

    cands.sort((a, b) => b.size - a.size || a.rank - b.rank);
    return [...new Set(cands.map((c) => c.url))].slice(0, 12);
  }

  /**
   * 解析一个站点该用哪张图标。
   * @param site { url, icon?, hi? }
   * @param opts.deep  忽略权限直接跑第四级（用户点了「查找高清图标」，权限已在点击里申请过）
   * @param opts.force 跳过记录与缓存，从头重新找一遍
   * @returns { url, w, h, source } 或 null（交给首字色块）
   */
  async function resolveIcon(site, opts = {}) {
    const { deep = false, force = false } = opts;
    let origin = '';
    try {
      origin = new URL(site.url).origin;
    } catch (e) {
      return null;
    }
    const host = hostOf(site.url);
    if (!origin || !host) return null;

    // 1) 手动填的：直接用，挂了再往下找
    const manual = String(site.icon || '').trim();
    if (/^(?:https?:|data:)/i.test(manual)) {
      const hit = /^data:/i.test(manual) ? { url: manual, w: 0, h: 0 } : await loadImage(manual);
      if (hit) return { ...hit, source: 'manual' };
    }
    // 2) 记录里的 hi
    if (!force && site.hi) {
      const hit = await loadImage(site.hi);
      if (hit) return { ...hit, source: 'record' };
      delete site.hi; // 这张已经取不到了，别再试它
    }
    // 3) 本地缓存
    const cached = iconCache[host];
    if (!force && cached && Date.now() - cached.t < (cached.url ? CACHE_OK_TTL : CACHE_FAIL_TTL)) {
      if (!cached.url) return null;
      const hit = await loadImage(cached.url);
      if (hit) return { ...hit, source: 'cache' };
      delete iconCache[host];
    }
    // 4) 猜常见路径
    let best = await bestOf(ICON_PATHS_HI.map((p) => origin + p));
    if (scoreOf(best) < ICON_GOOD) best = betterOf(best, await bestOf(ICON_PATHS_LO.map((p) => origin + p)));
    // 5) 还是不够清楚，就抓首页读站点自己声明的地址
    if (scoreOf(best) < ICON_GOOD && (deep || pagePerm)) {
      const urls = await declaredIconUrls(site.url).catch(() => []);
      if (urls.length) best = betterOf(best, await bestOf(urls));
    }

    if (best && scoreOf(best) > 0) {
      iconCache[host] = { url: best.url, w: scoreOf(best), t: Date.now() };
      saveIconCache();
      return { ...best, source: 'probe' };
    }
    iconCache[host] = { url: '', w: 0, t: Date.now() };
    saveIconCache();
    return null;
  }

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

  function paintImage(box, url, site) {
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
    img.addEventListener('error', () => paintLetter(box, site));
    img.src = url;
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
    // 找图标要联网（可能试好几组地址），先拿名称首字顶着，图片到位再换掉——不让格子空着
    const provisional = setTimeout(() => {
      if (box.isConnected && !box.querySelector('img')) paintLetter(box, site);
    }, 700);
    (async () => {
      let hit = null;
      try {
        hit = await iconLimiter(() => resolveIcon({ ...site, icon }));
      } catch (e) {}
      clearTimeout(provisional);
      if (!box.isConnected) return; // 这一格已经被重画过了
      if (hit) paintImage(box, hit.url, site);
      else paintLetter(box, site);
    })();
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
  let dlgHit = null; // 弹窗里这次解析出来的图标，保存时钉进记录，省得下次开标签页再找
  let dlgTimer = 0;
  let dlgToken = 0;

  const setHdStatus = (text, kind = '') => {
    const el = $('#hdFindStatus');
    if (!el) return;
    el.textContent = text;
    el.className = `hdf-text${kind ? ' ' + kind : ''}`;
  };
  const previewBox = () => $('#hdPreview');
  function previewShow(node) {
    const box = previewBox();
    if (!box) return;
    box.textContent = '';
    box.style.background = '';
    if (node) box.appendChild(node);
  }
  function previewLetter(site) {
    const seed = hostOf(site.url) || site.name || '';
    const box = previewBox();
    if (!box) return;
    box.textContent = '';
    box.style.background = `hsl(${hueOf(seed)} 50% 42%)`;
    const span = document.createElement('span');
    span.textContent = ([...(site.name || seed || '?')][0] || '?').toUpperCase();
    box.appendChild(span);
  }
  function previewImage(url) {
    const img = new Image();
    img.alt = '';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.src = url;
    previewShow(img);
  }

  // 弹窗里试算一次：网址 / 图标框一变就重跑，结果直接显示在预览小方框 + 状态行里
  async function findIcon(opts = {}) {
    const token = ++dlgToken;
    dlgHit = null;
    const rawUrl = $('#hdUrl').value.trim();
    const manual = $('#hdIcon').value.trim();
    const name = $('#hdName').value.trim() || hostOf(normalizeUrl(rawUrl)) || rawUrl;
    if (!rawUrl) {
      setHdStatus('填上网址后自动查找该站的清晰图标');
      previewShow(null);
      return null;
    }
    if (manual && !/^(?:https?:|data:)/i.test(manual)) {
      setHdStatus(`图标位将直接显示「${manual}」`);
      const span = document.createElement('span');
      span.textContent = manual;
      previewShow(span);
      return null;
    }
    const url = normalizeUrl(rawUrl);
    let ok = false;
    let hostname = '';
    try {
      const u = new URL(url);
      hostname = u.hostname;
      ok = !!hostname && (hostname.includes('.') || hostname === 'localhost');
    } catch (e) {}
    if (!ok) {
      setHdStatus('网址看起来不完整，补全成 example.com 这样才好找图标');
      previewShow(null);
      return null;
    }
    // 边打字边试算时，域名得像个完整域名再发请求（不然每敲几个字就打出去一轮探测）
    if (opts.auto && !/\.[a-z]{2,}$/i.test(hostname)) {
      setHdStatus('继续输入完整网址…');
      previewShow(null);
      return null;
    }
    const old = editingIndex >= 0 ? sites[editingIndex] : null;
    const site = {
      name,
      url,
      icon: /^(?:https?:|data:)/i.test(manual) ? manual : '',
      // 只有还是同一个站点时才沿用原记录里的高清图，换了站点就别留着旧的
      hi: old && hostOf(old.url) === hostOf(url) ? old.hi || '' : '',
    };
    setHdStatus(opts.deep ? '正在读网页，找它自己声明的图标…' : '正在查找清晰图标…');
    const hit = await iconLimiter(() => resolveIcon(site, { deep: opts.deep, force: opts.force }));
    if (token !== dlgToken) return null; // 又改了输入，这次结果作废
    dlgHit = hit;
    if (!hit) {
      previewLetter(site);
      setHdStatus(
        pagePerm ? '没找到现成图标，将用名称首字拼个色块' : '没找到现成图标；点「查找高清图标」授权读网页再试一次，否则用名称首字拼色块',
        'warn',
      );
      return null;
    }
    previewImage(hit.url);
    const px = scoreOf(hit);
    const label = px >= 4096 ? '矢量图标' : `${px}px`;
    if (px >= ICON_GOOD) setHdStatus(`已找到 ${label}`, 'ok');
    else if (pagePerm) setHdStatus(`已找到 ${label}（偏小，放大可能略糊）`, 'warn');
    else setHdStatus(`已找到 ${label}（偏小）· 点「查找高清图标」授权读网页再找一次`, 'warn');
    return hit;
  }

  function openDialog(index) {
    editingIndex = index;
    const site = index >= 0 ? sites[index] : null;
    $('#hdTitle').textContent = site ? '编辑快捷网址' : '添加快捷网址';
    $('#hdName').value = site ? site.name : '';
    $('#hdUrl').value = site ? site.url : '';
    $('#hdIcon').value = site ? site.icon || '' : '';
    dlgHit = null;
    const findBtn = $('#hdFindBtn');
    if (findBtn) findBtn.textContent = pagePerm ? '重新查找' : '查找高清图标';
    hasPagePermission().then((v) => {
      pagePerm = v;
      if (findBtn) findBtn.textContent = v ? '重新查找' : '查找高清图标';
    });
    dialog.hidden = false;
    setTimeout(() => $('#hdName').focus(), 30);
    if (site) findIcon(); // 编辑时先按现有记录显示一张（走缓存，很快）
  }
  function closeDialog() {
    dialog.hidden = true;
    editingIndex = -1;
    dlgHit = null;
    clearTimeout(dlgTimer);
  }
  $('#hdCancel').addEventListener('click', closeDialog);
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) closeDialog();
  });
  // 网址 / 图标一改就重新试算（防抖，别每敲一个字母就发一轮请求）
  $('#hdUrl').addEventListener('input', () => {
    clearTimeout(dlgTimer);
    dlgTimer = setTimeout(() => findIcon({ auto: true }), 500);
  });
  $('#hdIcon').addEventListener('input', () => {
    clearTimeout(dlgTimer);
    dlgTimer = setTimeout(() => findIcon({ auto: true }), 300);
  });
  // 「查找高清图标」：没有读取网页权限时，点击这一次同时申请权限（request 必须在点击事件里直接调用）
  $('#hdFindBtn')?.addEventListener('click', () => {
    if (pagePerm) return findIcon({ deep: true, force: true });
    const asked = askPagePermission();
    const after = (granted) => {
      pagePerm = !!granted;
      const findBtn = $('#hdFindBtn');
      if (findBtn) findBtn.textContent = pagePerm ? '重新查找' : '查找高清图标';
      if (!pagePerm) setHdStatus('没拿到读取网页的授权，只能在站点根目录里找；再点一次可以重试', 'warn');
      findIcon({ deep: pagePerm, force: true });
    };
    asked.then(after, () => after(false));
  });
  dialogForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const rawUrl = $('#hdUrl').value.trim();
    if (!rawUrl) return $('#hdUrl').focus();
    const url = normalizeUrl(rawUrl);
    const name = $('#hdName').value.trim() || hostOf(url) || rawUrl;
    const icon = $('#hdIcon').value.trim();
    // 以旧记录为基底合并：记录里还有 hi 之类的内部字段，重建对象会把它们悄悄丢掉
    // （曾经的 bug：编辑保存一次，DeepSeek 的高清图标就掉了，只剩首字色块）
    const old = editingIndex >= 0 ? sites[editingIndex] : null;
    const item = { ...(old || {}) };
    item.name = name;
    item.url = url;
    if (icon) item.icon = icon;
    else delete item.icon;
    if (!old || hostOf(old.url) !== hostOf(url)) delete item.hi; // 换了站点，旧的高清图不再适用
    if (dlgHit && dlgHit.source !== 'manual') item.hi = dlgHit.url; // 把刚查到的钉进记录
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
