// 用户上传的背景音乐，存在 IndexedDB 里。
//
// 为什么非存不可：插件的新标签页每打开一次都是一次全新的页面加载，只用 ObjectURL 的话
// 一关标签页曲子就没了，用户每开一次新标签页都得重传一遍——入口等于白给。
//
// 为什么是 IndexedDB 而不是 chrome.storage.local：后者按 JSON 序列化，Blob 存不进去，
// 得先转 base64（体积 +33%，一首 8MB 的 MP3 变 11MB），而它的默认配额只有 10MB。
// IndexedDB 能直接结构化克隆 Blob，配额也按整个扩展源算，宽松得多。
//
// 只在插件里启用（main.js 里判 NP）。网页版 / 壁纸版保持「上传即用、刷新即失」的老行为。
const DB_NAME = 'pelican.music';
const STORE = 'tracks';
const KEY = 'current';

function openDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('no indexedDB'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  });
}

// 一次事务一个 promise：回调式 API 包成 async，调用处才写得干净
function run(db, mode, fn) {
  return new Promise((resolve, reject) => {
    let out;
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    if (req) req.onsuccess = () => (out = req.result);
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

// items: [{ name, blob }]；空数组等于清空
export async function saveTracks(items) {
  let db;
  try {
    db = await openDb();
    await run(db, 'readwrite', (s) => (items.length ? s.put(items.map(({ name, blob }) => ({ name, blob })), KEY) : s.delete(KEY)));
    return true;
  } catch (e) {
    // 配额爆了或者浏览器不给写（无痕模式）：不致命，本次会话照样能听，只是留不到下次
    return false;
  } finally {
    db?.close();
  }
}

// 返回 [{ name, blob }]；读不到一律给空数组，调用方不用处理异常
export async function loadTracks() {
  let db;
  try {
    db = await openDb();
    const rec = await run(db, 'readonly', (s) => s.get(KEY));
    if (!Array.isArray(rec)) return [];
    return rec
      .filter((t) => t && t.blob instanceof Blob)
      .map((t) => ({ name: String(t.name || '未命名'), blob: t.blob }));
  } catch (e) {
    return [];
  } finally {
    db?.close();
  }
}

export async function clearTracks() {
  return saveTracks([]);
}
