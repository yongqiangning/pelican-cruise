/* 桌面层的开机标记。必须在 head 里同步执行 —— 先于首帧把类挂到 <html>，否则时钟和图标
   会先闪一下空白再冒出来（新标签页每开一次闪一次，很难受）。
   两个类：
     .home     —— 这一层要不要，看 config.js 里 window.__PELICAN_WP.home
     .home-off —— 上次点了树叶收起来没有，同步读 localStorage，首帧直接就是收起态，不闪 */
(() => {
  const cfg = window.__PELICAN_WP;
  if (!cfg || !cfg.home) return;
  const root = document.documentElement;
  root.classList.add('home');
  try {
    if (localStorage.getItem('pelican.home.hidden') === 'true') root.classList.add('home-off');
  } catch (e) {}
})();
