import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';

const minify = !process.argv.includes('--dev');
const res = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  minify,
  write: false,
  target: ['es2020'],
  legalComments: 'none',
  logLevel: 'warning',
});
// 内联进 HTML 时要把 </script 转义，否则会提前闭合脚本标签
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

// 壁纸的默认配置。普通页面不注入，壁纸版和浏览器插件版共用这一份。
// 时段 / 镜头 / 车速 / 画质 / 帧率都在这里改：tod = morning | day | dusk | night，
// cam = chase | side | cine | pov | orbit，kph 是车速（公里/小时）。
const WPC = `{
  enabled: true,   // 关掉就退回普通游戏页面
  tod: 'morning',  // 时段：morning 清晨 / day 白天 / dusk 傍晚 / night 晚上
  cam: 'chase',    // 镜头：chase 追随 / side 侧面跟拍 / cine 电影运镜 / pov 鹈鹕视角 / orbit 自由环绕
  kph: 6,          // 车速（公里/小时）。定速，以它为准，踏频随之自然变化
  cadence: 0,      // 目标踏频（rpm）。只在 kph 为 0 时生效；0 = 两者都不固定，用游戏默认
  q: 'high',       // 画质：low 流畅 / medium 均衡 / high 精美 / ultra 极致
  fps: 30,         // 锁帧，省电；设 0 表示不锁
  flow: false,     // true = 昼夜缓慢流动
  dayrate: 0.025   // 时间流速（时/秒），仅 flow 打开时有效：0.025 ≈ 16 分钟过完一天
}`;

const tpl = readFileSync('index.template.html', 'utf8');
const og = process.env.OG_IMAGE ? `<meta property="og:image" content="${process.env.OG_IMAGE}" />` : '';
const render = (configTag, title, jsBlock) =>
  tpl
    .replace('<!--OG_IMAGE-->', () => og)
    .replace('<!--WALLPAPER_CONFIG-->', () => configTag)
    .replace('<title>鹈鹕骑单车 · Pelican on a Bike</title>', () => `<title>${title}</title>`)
    .replace('<script>\n/*APP_JS*/\n</script>', () => jsBlock);

const inlineBlock = `<script>\n${js}\n</script>`;

mkdirSync('dist', { recursive: true });

const html = render('', '鹈鹕骑单车 · Pelican on a Bike', inlineBlock);
writeFileSync('dist/index.html', html);
console.log(`dist/index.html ${(html.length / 1024).toFixed(1)} KB (js ${(js.length / 1024).toFixed(1)} KB)`);

// 壁纸版：在 head 里内联一段配置，它同时给 <html> 打上 .wp（界面全隐藏），所以首帧就不会闪出 HUD。
const wpConfig = `<script>
/* ===== 桌面壁纸配置：改下面这一段就行 ===== */
window.__PELICAN_WP = ${WPC};
if (window.__PELICAN_WP.enabled) document.documentElement.classList.add('wp');
</script>`;
const wpHtml = render(wpConfig, '鹈鹕骑单车 · 动态壁纸', inlineBlock);
writeFileSync('dist/wallpaper.html', wpHtml);
console.log(`dist/wallpaper.html ${(wpHtml.length / 1024).toFixed(1)} KB`);

// 浏览器插件版：Chrome 扩展页面的 CSP 是 script-src 'self'，内联脚本会被拦掉，
// 所以这里必须拆成独立文件：config.js（配置 + .wp 标记，同步执行，先于首帧）+ app.js（打包好的代码）。
const extDir = 'dist/extension';
mkdirSync(extDir, { recursive: true });

// 独立 js 文件不需要转义 </script，用未转义的原始打包结果
writeFileSync(`${extDir}/app.js`, res.outputFiles[0].text);
writeFileSync(
  `${extDir}/config.js`,
  `/* ===== 新标签页配置：改下面这一段就行 ===== */
window.__PELICAN_WP = ${WPC};
if (window.__PELICAN_WP.enabled) document.documentElement.classList.add('wp');
`,
);

const newtab = render(
  '<script src="config.js"></script>',
  '新标签页 · 鹈鹕骑单车',
  '<script src="app.js"></script>',
);
writeFileSync(`${extDir}/newtab.html`, newtab);

// manifest.json 与图标是静态资源，直接从 extension/ 复制
const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
const iconFiles = Object.values(manifest.icons || {});
copyFileSync('extension/manifest.json', `${extDir}/manifest.json`);
for (const file of iconFiles) {
  if (existsSync(`extension/${file}`)) copyFileSync(`extension/${file}`, `${extDir}/${file}`);
}

const extFiles = ['manifest.json', 'newtab.html', 'app.js', 'config.js', ...iconFiles].filter((f) =>
  existsSync(`${extDir}/${f}`),
);
const extSize = extFiles.reduce((sum, f) => sum + readFileSync(`${extDir}/${f}`).length, 0);
console.log(
  `dist/extension/ ${(extSize / 1024).toFixed(1)} KB（${extFiles.join(' + ')}${
    iconFiles.length < 4 ? `，缺 ${4 - iconFiles.length} 个图标` : ''
  }）`,
);
