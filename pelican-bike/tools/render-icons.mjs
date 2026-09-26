// 用 Chrome(Skia) 把 extension/icon.svg 光栅化成 4 个尺寸的 PNG。
// 为什么不用 sips：它是把矢量按最终尺寸硬渲，16px 下 1.25px 的细线会糊成方块。
// 这里让 Chrome 以矢量方式渲到目标尺寸（canvas drawImage 走的是高质量抗锯齿），
// 透明背景原样保留。只在改图标时跑一次，产物提交进仓库。
//
//   node tools/render-icons.mjs            # 自动找本机 Chrome / Edge / Playwright 的 chromium
//   CHROME_PATH=/path/to/chrome node tools/render-icons.mjs
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const OUT = 'extension';
const SIZES = [16, 32, 48, 128];

const exe = [
  process.env.CHROME_PATH,
  typeof chromium.executablePath === 'function' ? chromium.executablePath() : '',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
].find((p) => p && existsSync(p));
if (!exe) throw new Error('没找到 Chrome，可以用 CHROME_PATH=<可执行文件> 指定');
console.log(`用 ${exe}`);

const svg = readFileSync(`${OUT}/icon.svg`, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage();

const pngs = await page.evaluate(
  async ({ svg, sizes }) => {
    const out = {};
    for (const s of sizes) {
      // 每个尺寸都用新的 blob + Image，避免复用上一次的低分辨率位图缓存
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      const img = new Image();
      await new Promise((ok, no) => {
        img.onload = ok;
        img.onerror = () => no(new Error('svg load failed'));
        img.src = url;
      });
      const c = document.createElement('canvas');
      c.width = c.height = s;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, s, s);
      URL.revokeObjectURL(url);
      out[s] = c.toDataURL('image/png').split(',')[1];
    }
    return out;
  },
  { svg, sizes: SIZES },
);

for (const s of SIZES) {
  writeFileSync(`${OUT}/icon${s}.png`, Buffer.from(pngs[s], 'base64'));
  console.log(`${OUT}/icon${s}.png  ${s}x${s}`);
}
await browser.close();
