# 把「鹈鹕骑单车」设成 Windows 10 桌面动态壁纸

壁纸模式就是**隐藏界面之后的骑行画面**：自动开始巡航，默认固定在**清晨**光线的**追随**机位（镜头在鹈鹕斜后方跟着走），车速定在 **6 km/h**；鼠标键盘都不响应，也不会出声。整份文件是单个 HTML，不需要服务器、不联网、无外部素材。

画面从第一帧起就是稳态：没有起步加速、没有镜头推拉，围巾和坐姿在首帧前已经落位，不会出现刚进入时晃一下再正常骑的过渡。

---

## 1. 先拿到壁纸文件

构建产物里的 **`dist/wallpaper.html`**（约 790 KB 单文件）就是壁纸本体。

仓库只存源码，`dist/` 不入库，所以要自己构建一次：

```powershell
cd pelican-bike
npm install --no-package-lock --registry=https://registry.npmmirror.com
node build.mjs
```

构建完会得到两个文件：

| 文件 | 用途 |
| --- | --- |
| `dist/index.html` | 正常游戏页面（带界面、能操作） |
| `dist/wallpaper.html` | **桌面壁纸用**，界面全隐藏、自动骑、清晨 + 追随机位 + 6 km/h、锁 30fps |

> 也可以先双击 `wallpaper.html`、用 Chrome / Edge 打开并 F11 全屏，先看看效果再决定要不要装工具。

---

## 2. 装一个动态壁纸工具：Lively Wallpaper（免费开源）

三选一：

**Microsoft Store（最省事）** — 商店搜索 **Lively Wallpaper** → 获取。

**winget** — 以管理员身份打开 PowerShell：

```powershell
winget install --id=rocksdanister.LivelyWallpaper -e
```

**GitHub** — 到 <https://github.com/rocksdanister/lively/releases> 下载 `LivelySetup.exe` 安装。

> Lively 依赖 **WebView2**（Chromium 内核）。Windows 10 一般都随 Edge 装好了；如果 Lively 报缺 WebView2，去微软官网装一个 "Microsoft Edge WebView2 Runtime" 即可。

---

## 3. 导入并设为壁纸

1. 打开 Lively
2. 点左上角的 **`+`** → 选择 **`Web Page` / 浏览文件** → 选中 `dist\wallpaper.html`
   （也可以**直接把 `wallpaper.html` 拖进 Lively 窗口**）
3. 预览没问题 → 点 **`Set as Wallpaper`**

搞定。想换回普通壁纸，在 Lively 里选回原来的图片即可。

---

## 4. 改时段 / 镜头 / 车速 / 画质 / 帧率

用记事本打开 `wallpaper.html`，`Ctrl+F` 搜索 **`__PELICAN_WP`**，会看到下面这一段（就在文件很靠前的位置），改完保存、在 Lively 里重新应用一次即可：

```js
window.__PELICAN_WP = {
  enabled: true,   // 关掉就退回普通游戏页面
  tod: 'morning',  // 时段：morning 清晨 / day 白天 / dusk 傍晚 / night 晚上
  cam: 'chase',    // 镜头：chase 追随 / side 侧面跟拍 / cine 电影运镜 / pov 鹈鹕视角 / orbit 自由环绕
  kph: 6,          // 车速（公里/小时）。定速，以它为准，踏频随之自然变化
  cadence: 0,      // 目标踏频（rpm）。只在 kph 为 0 时生效；0 = 两者都不固定，用游戏默认
  q: 'high',       // 画质：low 流畅 / medium 均衡 / high 精美 / ultra 极致
  fps: 30,         // 锁帧，省电；设 0 表示不锁
  flow: false,     // true = 昼夜缓慢流动
  dayrate: 0.025   // 时间流速（时/秒），仅 flow 打开时有效：0.025 ≈ 16 分钟过完一天
};
```

几个常用改法：

- **想要夜晚星空**：`tod: 'night'`
- **想要傍晚暖橙**：`tod: 'dusk'`
- **笔记本怕费电**：`q: 'medium'` + `fps: 24`
- **4K 屏觉得糊**：`q: 'ultra'`（4K 下会吃 GPU，注意散热）
- **想一直看光影变化**：`flow: true`（配合 `dayrate`，例如 `0.005` 约 80 分钟过完一天）
- **想看镜头切换**：`cam: 'cine'`（8 个机位循环的电影运镜）；`'side'` 是侧面跟拍、`'pov'` 是鹈鹕视角、`'orbit'` 是会缓慢自转的自由环绕
- **走快一点 / 慢一点**：改 `kph`，例如 `12` 或 `2`

> **车速和踏频只能定一个**，因为三者是绑死的：踏频 = 车速 ÷ 轮周长 × 齿比，其中只有车速能自己定。程序的做法是按 `kph` 定死车速，再自动挑一档（和游戏里自动变速同目标，约 86 rpm）、锁住变速，踏频就随之确定了。
>
> 默认 `kph: 6` 是慢速巡航，看着安静，但 6 km/h 挂在最低档也只能对应约 **34 rpm**，腿会显得踩得偏慢——真实骑行到这个速度也是这样。如果觉得踩得太慢，把车速提到 **`kph: 11.5`** 左右，最低档正好能配上 **65 rpm** 的自然踏频。
>
> 想反过来定踏频（老写法）：把 `kph` 改成 `0`、`cadence` 填目标圈数即可，程序会反推车速。

改完可以直接双击 `wallpaper.html` 用浏览器确认效果，再回 Lively 应用。

---

## 5. 资源占用

- 壁纸默认**锁 30 帧**，比 60 帧省一半左右的 GPU
- 画质自适应还在：帧率持续偏低会自动降渲染分辨率，恢复后自己升回来
- **Lively 默认在有全屏应用 / 游戏运行时自动暂停壁纸**（占用降到接近 0），这是它自带的设置，保持开启即可
- 多显示器：Lively 支持每个屏幕单独设一张，也可以一张跨所有屏幕

---

## 6. 如果你用的是 Wallpaper Engine（Steam，付费）

1. Wallpaper Engine → **创建壁纸** → 选 **网页 / Web**
2. 用它生成的工程目录里的 `index.html` 换成我们的 `wallpaper.html`（改名为 `index.html`）
3. 应用即可。WE 同样支持全屏时暂停、多屏、帧率限制。

---

## 7. 常见问题

**壁纸是纯黑 / 白屏？**
先双击用 Chrome 打开 `wallpaper.html` 确认文件本身正常。如果浏览器里正常、Lively 里黑屏，基本都是 WebView2 缺失或显卡驱动过旧，装一下 WebView2 Runtime。

**点桌面图标没反应？**
不会。壁纸画面本身不接收任何鼠标事件（画布交互和轨道控制都关掉了），桌面图标、右键菜单都正常。

**壁纸会不会出声？**
不会。壁纸模式压根不启动音频引擎，静音进入。

**改了配置没生效？**
Lively 会缓存壁纸文件；在 Lively 里把这张壁纸移除再重新导入一次，或者改完文件后重启 Lively。
