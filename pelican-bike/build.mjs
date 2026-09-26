import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';

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

// 插件版比壁纸版多两样东西（底部控制条 + 桌面层），都由下面单独追加，
// 这样壁纸版不会跟着长出一条控件栏，也不会多出时钟和图标格子。
const npUiConfig = `/* 底部控制条：true = 可以拖速度、切时段、做动作、换镜头、开关声音、开关背景音乐；false = 纯画面（等同桌面壁纸）
   也可以给对象按项裁剪（speed / tod / keys / acts / cams / sound / music），没写的项默认开，例如 { keys: false } 只藏快捷键按钮。
   注：控制条上的背景音乐出厂是关的（新标签页一开就放音乐太打扰，先让人听环境音），
   用户自己在控制条里开过一次之后，开关与音量记在 localStorage 里（pelican.music.*），下次开新标签页接着用 */
window.__PELICAN_WP.ui = true;
/* 桌面层：时钟 + 农历、搜索框、快捷网址（右上角树叶可一键收起）。false = 只剩画面 */
window.__PELICAN_WP.home = true;`;

// 桌面层的三个文件都住在 extension/ 里，只有插件产物会复制过去
const EXT_HOME_FILES = ['home.css', 'home.js', 'home-boot.js'];
const extHomeHtml = readFileSync('extension/home.html', 'utf8');
// home-boot.js 要在 head 里同步跑（先于首帧挂 .home / .home-off），否则每开一次新标签页都会闪一下
const extHomeHead = `<!-- 桌面层：结构见 build.mjs 注入的片段，样式在 home.css，逻辑在 home.js（另见 home-boot.js） -->
<link rel="stylesheet" href="home.css" />
<script src="home-boot.js"></script>`;

const tpl = readFileSync('index.template.html', 'utf8');

// 插件图标（extension/icon*.png）是从 extension/icon.svg 渲出来的，而网页的 favicon 内联在模板里，
// 同一只鹈鹕存了两份（网页要能单文件分发，favicon 不能外链）。只改一边的话，标签页上看到的
// 和插件图标就不是同一只了。这里顺手比一比，只提醒不报错。
const normSvg = (s) =>
  s
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/"/g, "'")
    .replace(/\s*\/>/g, '/>')
    .replace(/>\s+</g, '><')
    .replace(/\s+/g, ' ')
    .trim();
const favInTpl = tpl.match(/<link rel="icon" href="data:image\/svg\+xml,([^"]+)"/)?.[1];
if (favInTpl && normSvg(decodeURIComponent(favInTpl)) !== normSvg(readFileSync('extension/icon.svg', 'utf8'))) {
  console.warn('⚠ index.template.html 里的 favicon 与 extension/icon.svg 不一致了，插件图标需要重新生成：node tools/render-icons.mjs');
}

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
${npUiConfig}
if (window.__PELICAN_WP.enabled) document.documentElement.classList.add('wp');
`,
);

const newtab = render(
  '<script src="config.js"></script>',
  '新标签页 · 鹈鹕骑单车',
  '<script src="app.js"></script>',
)
  .replace('</head>', () => `${extHomeHead}\n</head>`)
  .replace('<script src="app.js"></script>', () => `${extHomeHtml}\n<script src="app.js"></script>`);
writeFileSync(`${extDir}/newtab.html`, newtab);

// manifest.json 与图标是静态资源，直接从 extension/ 复制
const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
const iconFiles = Object.values(manifest.icons || {});
copyFileSync('extension/manifest.json', `${extDir}/manifest.json`);
for (const file of iconFiles) {
  if (existsSync(`extension/${file}`)) copyFileSync(`extension/${file}`, `${extDir}/${file}`);
}
for (const file of EXT_HOME_FILES) {
  if (existsSync(`extension/${file}`)) copyFileSync(`extension/${file}`, `${extDir}/${file}`);
}

const extFiles = ['manifest.json', 'newtab.html', 'app.js', 'config.js', ...EXT_HOME_FILES, ...iconFiles].filter(
  (f) => existsSync(`${extDir}/${f}`),
);
const extSize = extFiles.reduce((sum, f) => sum + readFileSync(`${extDir}/${f}`).length, 0);

// 顺手压一个 zip，方便拷到别的机器再解压安装。纯 Node 手写，不调系统 zip 命令（Windows 也能构建）；
// 时间戳写死成固定值，同样的输入就产出同样的字节，便于比对。
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const DOS_DATE = 0x21; // 1980-01-01，固定值
function makeZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const deflated = deflateRawSync(data, { level: 9 });
    const packed = deflated.length < data.length ? deflated : data;
    const method = packed === deflated ? 8 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // 需要的解压版本
    local.writeUInt16LE(0x0800, 6); // 文件名按 UTF-8 解
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, nameBuf, packed);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(DOS_DATE, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(packed.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + packed.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, end]);
}
const zipPath = 'dist/pelican-newtab-extension.zip';
writeFileSync(zipPath, makeZip(extFiles.map((f) => [f, readFileSync(`${extDir}/${f}`)])));

console.log(
  `dist/extension/ ${(extSize / 1024).toFixed(1)} KB（${extFiles.join(' + ')}${
    iconFiles.length < 4 ? `，缺 ${4 - iconFiles.length} 个图标` : ''
  }）`,
);
console.log(`${zipPath} ${(readFileSync(zipPath).length / 1024).toFixed(1)} KB`);
