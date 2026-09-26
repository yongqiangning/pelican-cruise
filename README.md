<h1 align="center">pelican-cruise</h1>

<p align="center">
  <b>鹈鹕巡航</b> —— 一个 Three.js 海岸公路骑行游戏，附带桌面动态壁纸与浏览器新标签页插件
</p>

<p align="center">
  <b>一句话提示词 · One Shot —— Claude Opus 5.5 代码生成能力实测</b>
  <br />
  一个可玩的 3D 网页游戏，只给一句提示词，单会话生成，代码零人工改动，直接部署上线。
</p>

<p align="center">
  <a href="https://www.anthropic.com/claude/opus"><img src="https://img.shields.io/badge/Claude-Opus%205.5-D97757?style=for-the-badge" alt="Claude Opus 5.5" /></a>
  <img src="https://img.shields.io/badge/Three.js-r186-049EF4?style=for-the-badge&logo=threedotjs&logoColor=white" alt="Three.js r186" />
  <img src="https://img.shields.io/badge/esbuild-%E2%89%A50.28-FFCF00?style=for-the-badge&logo=esbuild&logoColor=black" alt="esbuild" />
  <a href="https://pages.cloudflare.com/"><img src="https://img.shields.io/badge/部署-Cloudflare%20Pages-F38020?style=for-the-badge&logo=cloudflare&logoColor=white" alt="Cloudflare Pages" /></a>
  <img src="https://img.shields.io/badge/提示词-1%20句-8A2BE2?style=for-the-badge" alt="One-shot" />
</p>

<p align="center">
  <a href="#这个仓库是什么">介绍</a> ·
  <a href="#游戏介绍">游戏介绍</a> ·
  <a href="#提示词原文">提示词原文</a> ·
  <a href="#在线体验">在线体验</a> ·
  <a href="#本地构建">本地构建</a> ·
  <a href="#桌面动态壁纸">桌面动态壁纸</a> ·
  <a href="#浏览器新标签页">浏览器新标签页</a> ·
  <a href="#仓库结构">仓库结构</a> ·
  <a href="#生成过程与验证">生成过程与验证</a>
</p>

---

## 这个仓库是什么

用 [Claude Opus 5.5](https://www.anthropic.com/claude/opus)（Claude Code CLI，1M 上下文，xhigh 推理强度）做的一次代码生成能力实测：**只给一句话提示词，单会话 one-shot 生成，全程零人工改动代码，生成后直接部署上线可玩。**

本仓库是在该原版基础上的**二次开发版**：只留下鹈鹕骑车，另外两个游戏已移除，并在玩法、时段、音效、桌面壁纸与浏览器插件几方面做了改动，详见下方的[二开改动记录](#二开改动记录)。

规则很简单：

- **一句话提示词** — 需求描述只有一句话，不写需求文档、不给参考代码、不做多轮追问
- **单会话生成** — 在一个会话内完成：查资料、搭工程、写代码、构建、测试、部署全部由模型自主进行
- **零人工改动** — 仓库里的源码就是模型写出的原样，人工没有改过一行；连本 README 也是模型写的
- **真实部署** — 部署在 Cloudflare Pages 上，点开链接即可玩

工程是单文件 HTML（esbuild 打包内联，无外部资源依赖）：模型、纹理、动画、音效全部由代码程序化生成，不引用任何图片、音频或第三方素材。

## 游戏介绍

| 游戏 | 类型 | 源码目录 | 模块数 | 构建产物 | 在线体验 |
| --- | --- | --- | --- | --- | --- |
| 🚲 鹈鹕骑自行车 | 海岸公路休闲骑行 | `pelican-bike/` | 11 个 JS 模块 | ~800 KB | [claude-opus-5-5.riba2534.cn](https://claude-opus-5-5.riba2534.cn/) |

### 🚲 鹈鹕骑自行车

戴头盔墨镜、脖子系红围巾的鹈鹕在海岸公路上骑车兜风。围巾是布料物理模拟，海面有波浪与岸边碎浪；时段可在**清晨 / 白天 / 傍晚 / 晚上**四档之间手动切换（也可微调具体时刻）。W/S 加减速、A/D 变道、空格跳跃、T 展翅抬前轮；10 个成就、5 种镜头（含电影运镜和鹈鹕视角）、浏览器实时合成的音效与轻柔氛围音乐、触屏按钮与按帧率自适应画质。不操作时它会自动巡航变道。

**声音都能单独调**：主音量、海浪/风声音量（可拖到 0 或一键关闭）、音乐音量各自独立；背景音乐除了内置的实时合成氛围乐，还能上传自己的 MP3 当播放列表。

### 二开改动记录

本仓库在原 one-shot 生成的基础上做过二次开发，改动如下：

| 改动 | 说明 | 涉及文件 |
| --- | --- | --- |
| 移除吃鱼玩法 | 删掉可收集鱼、嘴部碰撞判定、鱼分数 HUD、4 个鱼类成就、自动驾驶追鱼逻辑与吞鱼动画/音效 | `main.js` `pelican.js` `audio.js` `index.template.html` |
| 四档时段手动设置 | 新增 清晨/白天/傍晚/晚上 预设，HUD 按钮、参数面板下拉与 <kbd>N</kbd> 都能切；默认关闭时间自动流动 | `main.js` `index.template.html` |
| 更轻柔的音乐 | 生成式音乐改为慢速氛围铺底（无鼓点），音乐总线加低通削高频，环境音整体降噪 | `audio.js` |
| 自定义背景音乐 | 支持上传 MP3（多选、循环播放），与生成式音乐互斥；HUD 🎧 与参数面板两个入口 | `audio.js` `main.js` `index.template.html` |
| 海浪/风声可控 | 环境音走独立总线，参数面板新增「海浪 / 风声音量」滑块与「海浪与风声」开关，HUD 🌊 一键开关 | `audio.js` `main.js` `index.template.html` |
| 去掉自行车机械拟音 | 移除滑行时的飞轮棘轮声（不踩踏滑行时每秒数次密集触发的「嗒嗒」声）与自动变速换档时的「咔哒」声；背景层只留风声、海浪声与胎噪，三者音量仍由参数面板控制。动作音效（跳跃落地、车铃、大叫、特技）不受影响 | `audio.js` `main.js` |
| 桌面动态壁纸模式 | 新增 `wallpaper.html` 产物：自动骑行、界面全隐藏、输入不响应、不启动音频、锁 30fps；默认清晨 + 追随镜头 + 6 km/h 定速；首帧前空推 3 秒预热，从稳态开始（无起步加速与镜头推拉）；时段/镜头/车速或踏频/画质/帧率写在文件内可编辑的配置段里 | `main.js` `index.template.html` `build.mjs` `WALLPAPER.md` |
| 浏览器新标签页插件 | 新增 `dist/extension/`（Manifest V3，`chrome_url_overrides.newtab`）：装完新建标签页即同款画面；因扩展页面 CSP 禁内联脚本，拆成 `config.js`（同步执行，先于首帧加 `.wp`）+ `app.js`；附 4 个尺寸图标与可拷走的 zip | `build.mjs` `extension/` `EXTENSION.md` |
| 插件底部控制条 | 新标签页底部新增一条控制条：速度滑块（2–30 km/h，改速度时重挑档位，踏频不跑飞）、四档时段、动作（跳跃 / 特技 / 车铃 / 大叫）、五档镜头、声音开关（默认关，点了才启动音频）与「海浪」环境音音量滑块；鼠标与键盘交互一并放开（点鹈鹕会叫、可拖拽转视角）；`ui` 可整体关掉或按项裁剪，桌面壁纸版完全不受影响 | `main.js` `index.template.html` `EXTENSION.md` |
| 去掉鱼跃水花声 | 鱼跃水花是 400–2400 Hz 宽带噪声，而背景层（海浪 / 风声 / 胎噪）全在 600 Hz 以下，成了背景里唯一的高频事件、每几秒响一次；现只去掉声音，画面上的水花粒子保留（`splash()` 方法保留备用） | `main.js` `audio.js` |
| 修音频节点泄漏 | 每响一个音符或音效都新建节点并接到常驻总线上，却从不摘下，实测每分钟累积约 250 个、挂机越久音频图越大；现在每个一次性声音在其 `onended` 时自动断线，实测残留节点稳定在 30–40 个常数级、不再随时间增长（`dispose()` 统一处理 tone / click / splash / whoosh / gull / honk） | `audio.js` |
| 新标签页桌面层 | 新标签页加了时钟（带农历，用浏览器内置中国历法）、搜索框（引擎可切、网址自动识别直开）、可增删拖拽的快捷网址（删错 8 秒撤销、图标自动降级为首字色块），以及右上角树叶一键收起（状态持久化、首帧同步所以不闪）；焦点在输入框 / 按钮时游戏让开键盘，且不再每次开标签页弹提示；桌面层只随插件产物构建，游戏版与壁纸版一个字节都不带 | `extension/home.html` `home.css` `home.js` `home-boot.js` `build.mjs` |
| 构建自动压 zip | 每次构建顺手把 `dist/extension/` 压成 `pelican-newtab-extension.zip`，不再需要手工打包（纯 Node 手写，不调系统 `zip` 命令，Windows 也能构建；时间戳写死，产物可复现） | `build.mjs` |
| 修正 npm 源 | `package-lock.json` 记录的是作者内网镜像，本机不可达；构建改用可达源（见下） | — |

## 提示词原文

完整输入就下面这一句话，一字未改：

> 生成一个鹈鹕骑自行车的 3D 页面，尽可能把你所有的能力全部都用上. 然后上传到 CDN 上, 把访问链接给我

## 在线体验

原作者部署的**原版**（未含本仓库的二开改动，仍有吃鱼玩法）：

<https://claude-opus-5-5.riba2534.cn/>

本仓库的二开版目前只提供源码，克隆后按上面的构建命令自行构建运行。

## 本地构建

`src/` 源码经 esbuild 打包内联进单个 HTML，无运行时外部依赖。

```bash
cd pelican-bike

npm install       # 安装依赖（three、esbuild 等）
node build.mjs    # 输出 dist/index.html（游戏）、dist/wallpaper.html（壁纸）、dist/extension/（浏览器插件）

# 直接用浏览器打开 dist/index.html 即可游玩
```

> 若 `npm install` 报 502：仓库里的 `package-lock.json` 记录的是作者内网的 npm 镜像地址，换台机器就拉不到。绕过锁文件、改用可达的源即可：
>
> ```bash
> npm install --no-package-lock --registry=https://registry.npmmirror.com
> ```

## 桌面动态壁纸

构建产物里的 `dist/wallpaper.html` 就是**隐藏界面之后的骑行画面**，可以拿来当 Windows 桌面动态壁纸：

- 自动开始巡航，默认固定在**清晨**光线的**追随**机位，车速定在 **6 km/h**，没有开场遮罩和任何界面元素
- 从第一帧起就是稳态：没有起步加速、镜头也不推拉，不会出现刚进入时晃一下再正常骑的过渡
- 鼠标、键盘都不响应（不会挡住桌面图标操作），也不启动音频
- 默认锁 30fps 省电，画质自适应仍在
- 时段 / 镜头 / 车速 / 画质 / 帧率都写在文件里**一小段可直接编辑的配置**里，记事本改一行就行

装一个免费的 [Lively Wallpaper](https://github.com/rocksdanister/lively)，把 `wallpaper.html` 拖进去即可。完整步骤（含可选时段、夜景、4K 屏调优、Wallpaper Engine 方案、常见问题）见 **[WALLPAPER.md](./WALLPAPER.md)**。

## 浏览器新标签页

同一套画面也做成了 **Chrome / Edge 插件**：装完以后，每次**新建标签页就是那只鹈鹕在骑车**——清晨 + 跟随镜头 + 6 km/h 定速起步、锁 30fps。

比桌面壁纸多**一层桌面信息**：

- **时钟**：正上方大字号，下面一行「9月25日 星期五 八月十五」，农历用浏览器内置的中国历法算，不自己维护月相表
- **搜索框**：输入关键词去搜，输入网址（`github.com`、`localhost:3000`）直接打开；左侧小图标可切必应 / 百度 / Google / 搜狗 / 知乎 / B 站；按 <kbd>/</kbd> 直接聚焦
- **快捷网址**：预置 12 个常用站点，可增删改、拖拽排序，删错有 8 秒撤销；图标自动去站点取 favicon，取不到就退成名称首字的彩色方块
- **右上角一片树叶**：点一下把这一层全收起来、只留画面，再点一下放回来——状态会记住，快捷键 <kbd>L</kbd>

还有**一条底部控制条**，所以新标签页不只是看着，也能上手：

- **速度**：拖滑块，2–30 km/h 随便定（松开 W/S 后会自动回到这个速度）
- **时段**：清晨 / 白天 / 傍晚 / 晚上 一键切
- **动作**：跳跃、特技（展翅 + 抬前轮）、按车铃、鹈鹕大叫
- **镜头**：追随 / 侧拍 / 电影 / 鹈鹕视角 / 自由环绕
- **声音**：默认关，点一下开（音乐 + 海浪风声 + 音效），切走标签页自动静音；右边的「**海浪**」滑块单独调环境音音量，拖到 0 就是静音
- 键盘同样可用：<kbd>W</kbd><kbd>S</kbd><kbd>A</kbd><kbd>D</kbd>、<kbd>空格</kbd>、<kbd>T</kbd>、<kbd>B</kbd>、<kbd>H</kbd>、<kbd>C</kbd>、<kbd>N</kbd>、<kbd>M</kbd>、<kbd>U</kbd>

> 完整的**参数面板**（巡航速度、自动变速、日期时间、画质、音乐与环境音各项音量）在**游戏页**里——点右上角工具条上的 <kbd>⚙️</kbd> 打开。壁纸版与新标签页把它刻意隐藏了（桌面上那个窗口连鼠标都不属于它），所以插件里调环境音音量就用控制条上那个「海浪」滑块。

插件本体是 `dist/extension/`，Manifest V3，用 `chrome_url_overrides.newtab` 接管新标签页；**不申请任何权限**（连 `storage` 都没要，数据存在扩展自己的 localStorage 里），约 848 KB（含 4 个尺寸图标），完全离线——唯一会联网的是你点开的网页，以及浏览器为快捷网址取一次站点自己的 `favicon.ico`（不经过第三方图标服务）。`dist/pelican-newtab-extension.zip` 是它的压缩包，方便拷到别的机器再解压安装。

时段 / 镜头 / 车速 / 画质 / 帧率同样写在一小段可直接编辑的配置里（`config.js`）：`window.__PELICAN_WP.ui` 管底部控制条，`window.__PELICAN_WP.home` 管时钟 / 搜索 / 快捷网址那一层，任意一个设成 `false` 就少一层，两个都关就是与桌面壁纸完全一致的纯画面；把 `enabled` 改成 `false` 则新标签页变成**可以玩**的完整游戏。

安装方式：`chrome://extensions` → 打开开发者模式 → 加载已解压的扩展程序 → 选中 `dist/extension` 文件夹。完整步骤与常见问题见 **[EXTENSION.md](./EXTENSION.md)**。

## 仓库结构

```
├── WALLPAPER.md            # 桌面动态壁纸的安装与调参说明（Windows 10 / Lively）
├── EXTENSION.md            # 浏览器插件（新标签页）的安装与调参说明
└── pelican-bike/           # 鹈鹕骑自行车
    ├── src/                # 11 个模块：pelican / bicycle / ocean / fish / sky / effects / audio ...
    ├── extension/          # 插件资源：manifest.json + icon16/32/48/128.png，
    │                       # 以及桌面层的 home.html（片段）/ home.css / home.js / home-boot.js
    ├── index.template.html # 页面模板（构建时注入 og:image 与打包后的 JS）
    ├── build.mjs           # esbuild 构建脚本，一次产出 index.html + wallpaper.html + extension/
    └── package.json
```

仓库只保存源码；`node_modules/`、`dist/` 构建产物不入库，克隆后执行上面的构建命令即可完整还原。

## 生成过程与验证

生成过程中模型自主完成的事情（摘录自会话记录）：

- **自测** — 用无头浏览器实测：加载运行无报错、模拟按键跑完整骑行；做了 320 秒快进浸泡测试（跑完一整个昼夜循环，几何体 / 纹理数量恒定，JS 堆 16–26 MB 平稳无泄漏），并专门跨过 36 km 里程取模边界验证
- **自我审查** — 交付前派子代理独立审查代码，找出 12 个问题并全部修复（如长时间骑行后海面跳变、切换画质漏显存）
- **线上修复** — 上线后偶发黑屏，模型通过人为注入 NaN 复现定位（Bloom 遇无效像素扩散成黑块），加了泛光前清理 pass 并修了海面菲涅尔等两处源头，重新部署
- **部署运维** — 完成 CDN 上传与缓存刷新、Cloudflare Pages 项目创建、域名绑定与证书等待

## 说明

- 原始版本由 Claude Opus 5.5 在 Claude Code 中生成（2026-09），源码与 README 为模型输出原样
- 本仓库在其基础上做过二次开发，具体改动见上面的「二开改动记录」
