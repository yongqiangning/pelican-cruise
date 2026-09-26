import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import GUI from 'lil-gui';
import { createSky, SKY, samplePalette, sunDirection, moonDirection, nightFactor } from './sky.js';
import { createOcean, waveHeight, wavePhases, SEA_LEVEL } from './ocean.js';
import { createWorld, terrainHeight } from './world.js';
import { createBicycle, WHEEL_R, GEARS, BIKE_POINTS } from './bicycle.js';
import { createPelican } from './pelican.js';
import { fishGeometry } from './fish.js';
import { Particles, Confetti, SpeedLines, Scarf } from './effects.js';
import { AudioEngine } from './audio.js';
import { clamp, lerp, damp, smoothstep, TAU, mulberry32 } from './util.js';

const Q = new URLSearchParams(location.search);
const qp = (k, d) => (Q.has(k) ? Q.get(k) : d);
const isTouch = matchMedia('(pointer: coarse)').matches;
const $ = (s) => document.querySelector(s);

// ---------------- 桌面壁纸模式 ----------------
// wallpaper.html 会在 head 里注入 window.__PELICAN_WP（一行可改的默认配置），并提前给 <html> 加 .wp，
// 避免首帧闪出界面。这里兼容 URL 参数：?wp=1&tod=night&q=medium&maxfps=24
const WPC = window.__PELICAN_WP || {};
const WP = qp('wp', WPC.enabled ? '1' : '0') === '1';
if (WP) document.documentElement.classList.add('wp');
// 新标签页插件的控制条：WPC.ui = true 全开；给对象则按项裁剪，没写的项默认开
// （speed 速度滑块 / tod 时段 / keys 快捷键按钮 / acts 动作 / cams 镜头 / sound 声音）。
// 桌面壁纸版不带控制条 —— 桌面上那个窗口连鼠标都不属于它，控件没意义，也挡图标。
const uiCfg = WPC.ui ?? (qp('ui', '0') === '1');
const UI_ALL = { speed: true, tod: true, keys: true, acts: true, cams: true, sound: true };
const NP = WP && uiCfg ? { ...UI_ALL, ...(uiCfg === true ? {} : uiCfg) } : null;
if (NP) document.documentElement.classList.add('wpui');
// >0 表示锁帧（壁纸模式默认 30，省电、也不至于看着卡）
const WP_FPS = WP ? +qp('maxfps', WPC.fps || 30) : 0;
const WP_GAP = WP_FPS > 0 ? 1000 / WP_FPS : 0;

// ---------------- 画质 ----------------
const DPR = window.devicePixelRatio || 1;
const QUALITY = {
  low: { name: '流畅', pr: Math.min(DPR, 1) * 0.8, shadow: 1024, bloom: false, msaa: 0, density: 0.5 },
  medium: { name: '均衡', pr: Math.min(DPR, 1.25), shadow: 2048, bloom: true, msaa: 2, density: 0.8 },
  high: { name: '精美', pr: Math.min(DPR, 1.75), shadow: 2048, bloom: true, msaa: 4, density: 1 },
  ultra: { name: '极致', pr: Math.min(DPR, 2.25), shadow: 4096, bloom: true, msaa: 4, density: 1.25 },
};
let qualityKey = qp('q', WPC.q || (isTouch ? 'medium' : 'high'));
if (!QUALITY[qualityKey]) qualityKey = 'high';
let quality = QUALITY[qualityKey];

// ---------------- 渲染器 ----------------
const canvasHost = $('#app');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
} catch (e) {
  $('#fallback').hidden = false;
  throw e;
}
renderer.setPixelRatio(quality.pr);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
canvasHost.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xffffff, 0.0052);
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.05, 900);
scene.add(camera);
const orbitCam = camera.clone();

// ---------------- 天空 / 环境光 ----------------
const sky = createSky();
scene.add(sky.mesh);
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
envScene.add(sky.envMesh);
let envRT = null;
let envHour = -99;
function refreshEnv() {
  const rt = pmrem.fromScene(envScene, 0, 0.1, 100);
  if (envRT) envRT.dispose();
  envRT = rt;
  scene.environment = rt.texture;
}

const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(quality.shadow, quality.shadow);
{
  const s = 7.5;
  Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 80 });
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 2.5;
}
scene.add(sun, sun.target);
const lampLights = [new THREE.PointLight('#ffc27a', 0, 14, 1.6), new THREE.PointLight('#ffc27a', 0, 14, 1.6)];
lampLights.forEach((l) => scene.add(l));
const lampPos = [new THREE.Vector3(), new THREE.Vector3()];
// 夜间跟随相机的柔和补光，保证主角可读
const fillLight = new THREE.PointLight('#b9c8ff', 0, 10, 1.2);
fillLight.position.set(0.6, 0.8, 0.5);
camera.add(fillLight);

// ---------------- 世界 ----------------
const ocean = createOcean();
scene.add(ocean.mesh);
const world = createWorld(scene, { density: quality.density });

// ---------------- 骑手 ----------------
const rider = new THREE.Group();
rider.rotation.order = 'YXZ';
const wheelieRoot = new THREE.Group();
wheelieRoot.position.set(BIKE_POINTS.rearHub.x, 0, 0);
rider.add(wheelieRoot);
const content = new THREE.Group();
content.position.set(-BIKE_POINTS.rearHub.x, 0, 0);
wheelieRoot.add(content);
const bike = createBicycle();
const pelican = createPelican();
content.add(bike.group, pelican.root);
scene.add(rider);

// ---------------- 特效 ----------------
const dust = new Particles(scene, 420, { additive: false, opacity: 0.35 });
const sparkles = new Particles(scene, 360, { additive: true });
const splash = new Particles(scene, 360, { additive: false });
const confetti = new Confetti(scene);
const speedLines = new SpeedLines(camera);
const scarf = new Scarf(scene);

// 海里的鱼：只做环境点缀（跃出海面），不参与任何玩法
const fishGeo = fishGeometry();
const fishMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.6, roughness: 0.25, emissive: new THREE.Color('#1f6b8f'), emissiveIntensity: 0.45, side: THREE.DoubleSide });
// 跃出海面的鱼
const jumpers = [];
for (let i = 0; i < 5; i++) {
  const m = new THREE.Mesh(fishGeo, fishMat);
  m.scale.setScalar(1.8);
  m.visible = false;
  scene.add(m);
  jumpers.push({ mesh: m, t: -1, x: 0, z: 0, dur: 1.2, h: 1.5, dir: 1 });
}

// 调试：?nantest=1 在画面中放一个输出 NaN/Inf 的小方块，用于验证后期清理
if (qp('nantest', '0') === '1') {
  const bad = new THREE.Mesh(
    new THREE.PlaneGeometry(0.06, 0.06),
    new THREE.ShaderMaterial({
      uniforms: { uZero: { value: 0 } },
      vertexShader: 'void main(){ gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'uniform float uZero; void main(){ float n = uZero / uZero; float i = 1.0 / uZero; gl_FragColor = vec4(n, i, n, 1.0); }',
    }),
  );
  bad.position.set(0.3, 1.3, 0.6);
  scene.add(bad);
}

// ---------------- 后期 ----------------
// 泛光前清理 NaN/Inf：一个坏像素会被 Bloom 的多级模糊扩散成大块黑色矩形。
// 用位运算判断（不依赖 isnan，避免被驱动的快速数学优化掉），并把 HDR 值限制在安全范围内
const sanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    float fixf(float x) {
      uint b = floatBitsToUint(x);
      if ((b & 0x7f800000u) == 0x7f800000u) return ((b & 0x007fffffu) == 0u && (b & 0x80000000u) == 0u) ? 48.0 : 0.0;
      return clamp(x, 0.0, 48.0);
    }
    void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb; gl_FragColor = vec4(fixf(c.r), fixf(c.g), fixf(c.b), 1.0); }`,
};
const colorGrade = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.28 },
    uAberration: { value: 0 },
    uGrain: { value: 0.035 },
    uTime: { value: 0 },
    uWarm: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uVignette; uniform float uAberration; uniform float uGrain; uniform float uTime; uniform float uWarm; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
    void main(){
      vec2 c = vUv - 0.5; float r = length(c);
      vec2 off = c * uAberration * r;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      col *= mix(1.0, smoothstep(0.85, 0.2, r), uVignette);
      col *= mix(vec3(1.0), vec3(1.06, 1.0, 0.92), uWarm);
      col *= 1.0 + (h(vUv * 1000.0 + fract(uTime)) - 0.5) * uGrain * 2.0;
      gl_FragColor = vec4(col, 1.0);
    }`,
};
let composer;
let bloom;
let gradePass;
function buildComposer() {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: quality.msaa });
  if (composer) {
    composer.passes.forEach((p) => p.dispose?.());
    composer.dispose();
  }
  composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(innerWidth, innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  if (qp('nosanitize', '0') !== '1') composer.addPass(new ShaderPass(sanitizeShader));
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.4, 0.55, 0.92);
  bloom.enabled = quality.bloom && settings.bloom;
  composer.addPass(bloom);
  gradePass = new ShaderPass(colorGrade);
  composer.addPass(gradePass);
  composer.addPass(new OutputPass());
}

// ---------------- 时段预设 ----------------
// 太阳高度角决定整体光照（sky.js 的 samplePalette 按高度角插值），所以时段直接用具体时刻表示
const TIME_PRESETS = {
  morning: { hour: 6.5, label: '清晨', icon: '🌅' },
  day: { hour: 12.2, label: '白天', icon: '☀️' },
  dusk: { hour: 17.4, label: '傍晚', icon: '🌇' },
  night: { hour: 22, label: '晚上', icon: '🌙' },
};
const TIME_ORDER = ['morning', 'day', 'dusk', 'night'];
let timeOfDay = qp('tod', WPC.tod || 'dusk');
if (!TIME_PRESETS[timeOfDay]) timeOfDay = 'dusk';

// ---------------- 设置 / 状态 ----------------
const settings = {
  cruise: +qp('speed', 7.5),
  // 定速（公里/小时）与目标踏频（rpm），两者只能生效一个：kph 优先，都设 0 = 游戏默认行为
  kph: +qp('kph', WPC.kph ?? 0),
  cadence: +qp('cadence', WPC.cadence ?? 0),
  autopilot: true,
  autoGear: true,
  timeOfDay,
  hour: Q.has('time') ? +qp('time', TIME_PRESETS[timeOfDay].hour) : TIME_PRESETS[timeOfDay].hour,
  dayRate: +qp('dayrate', WPC.dayrate ?? 0.025),
  timeFlow: qp('flow', WPC.flow ? '1' : '0') === '1',
  bloom: true,
  bloomBoost: 1,
  exposure: 1,
  waveAmp: 1,
  cloud: 0.42,
  fog: 1,
  helmet: true,
  glasses: qp('glasses', 'auto'),
  scarf: true,
  lookMouse: !WP || !!NP,
  volume: 0.8,
  envVolume: +qp('env', 0.5),
  envOn: qp('envon', '1') === '1',
  music: true,
  musicVolume: 0.55,
  musicCustom: false,
  trackName: '未选择（用内置生成式音乐）',
  quality: qualityKey,
  showFps: qp('fps', '0') === '1',
};
buildComposer();

// 手动切换时段：直接把时刻拨到预设值（默认不再自动昼夜循环）
let todShown = null;
function syncTimeButtons(key) {
  if (key === todShown) return;
  todShown = key;
  document.querySelectorAll('[data-time]').forEach((b) => b.classList.toggle('on', b.dataset.time === key));
}
// 时刻被微调或者开自动流动后，高亮会跟着回到最接近的时段
function refreshTimeHighlight() {
  let key = null;
  for (const k of TIME_ORDER) {
    if (Math.abs(TIME_PRESETS[k].hour - settings.hour) < 0.7) key = k;
  }
  syncTimeButtons(key);
}
function setTimeOfDay(key) {
  const p = TIME_PRESETS[key];
  if (!p) return;
  settings.timeOfDay = key;
  settings.hour = p.hour;
  syncTimeButtons(key);
}
function cycleTimeOfDay() {
  const i = TIME_ORDER.indexOf(settings.timeOfDay);
  setTimeOfDay(TIME_ORDER[(i + 1) % TIME_ORDER.length]);
  const p = TIME_PRESETS[settings.timeOfDay];
  toast(p.icon, `时段：${p.label}`, '参数面板里也能手动切换');
}
syncTimeButtons(settings.timeOfDay);

const S = {
  speed: settings.cruise * 0.6,
  distance: 0,
  lane: 0.9,
  laneV: 0,
  laneTarget: 0.9,
  prevLaneV: 0,
  latAcc: 0,
  lean: 0,
  steer: 0,
  crank: 0,
  wheel: 0,
  gear: 2,
  y: 0,
  vy: 0,
  airborne: false,
  trick: 0,
  trickT: 0,
  wheelie: 0,
  accel: 0,
  pedaling: true,
  cadence: 0,
  jumps: 0,
  tricks: 0,
  bells: 0,
  honks: 0,
  lastSteer: -99,
  lastGearManual: -99,
  lastPointer: -99,
  started: false,
  paused: false,
  t: 0,
  time: 0,
};

// ---------------- 定速 / 固定踏频 ----------------
// 车速、踏频、齿比三者是绑死的：踏频 = 车速 / 轮周长 × 齿比，其中只有车速能自由设定。
// 所以「定速」和「定踏频」只能二选一，车速优先：
//   1) kph > 0（公里/小时）→ 车速定死，档位挑「踏频最接近 86」的那一档（和游戏里的自动变速同目标）
//   2) 否则 cadence > 0    → 踏频定死，车速反推，档位挑「换算车速最接近原巡航速度」的那一档
const WHEEL_CIRC = WHEEL_R * TAU;
const cadenceAt = (i, v) => (v / WHEEL_CIRC / (GEARS[i][0] / GEARS[i][1])) * 60;
// 挑「踏频最接近 86 rpm」的那一档，跟游戏里的自动变速是同一个目标
const pickGearForSpeed = (v) => {
  let pick = 0;
  GEARS.forEach((_, i) => {
    if (Math.abs(cadenceAt(i, v) - 86) < Math.abs(cadenceAt(pick, v) - 86)) pick = i;
  });
  return pick;
};
if (settings.kph > 0) {
  settings.cruise = settings.kph / 3.6;
  S.gear = pickGearForSpeed(settings.cruise);
  settings.autoGear = false;
} else if (settings.cadence > 0) {
  const speedFor = (i) => (settings.cadence / 60) * WHEEL_CIRC * (GEARS[i][0] / GEARS[i][1]);
  let pick = 0;
  // 选换算出的车速最接近原本巡航速度的那一档，观感速度不至于突变
  GEARS.forEach((_, i) => {
    if (Math.abs(speedFor(i) - settings.cruise) < Math.abs(speedFor(pick) - settings.cruise)) pick = i;
  });
  S.gear = pick;
  settings.cruise = speedFor(pick);
  settings.autoGear = false;
}
// 壁纸不做起步加速：直接从稳定巡航速度开始，否则刚进入时那一两秒的加速会带着鹈鹕前后晃
if (WP) {
  S.speed = settings.cruise;
  S.accel = 0;
}
// 运行时改定速（新标签页控制条的速度滑块走这里）。档位跟着重挑，免得速度一变踏频就飞了；
// 车速不硬跳 —— updateRide 会按 (cruise - speed) 自己加速/减速过去，看着像真的在踩。
function setCruiseKph(v) {
  settings.kph = v;
  settings.cruise = v / 3.6;
  S.gear = pickGearForSpeed(settings.cruise);
  settings.autoGear = false;
}

const keys = {};
const achieved = new Set();

// ---------------- 音频 ----------------
const audio = new AudioEngine();

// ---------------- 相机 ----------------
const controls = new OrbitControls(orbitCam, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 1.1;
controls.maxDistance = 28;
controls.maxPolarAngle = Math.PI * 0.495;
controls.enablePan = false;
controls.autoRotateSpeed = 0.55;
// 壁纸模式下鼠标不属于这个窗口，直接关掉轨道控制，免得桌面上的点击被吃掉
// （新标签页是正常网页，鼠标就是拿来操作的，得留着）
if (WP && !NP) controls.enabled = false;
controls.addEventListener('start', () => {
  S.lastOrbitInput = S.time;
  controls.autoRotate = false;
});
const focus = new THREE.Vector3();
const prevFocus = new THREE.Vector3();
const CAMS = [
  { id: 'orbit', label: '自由环绕' },
  { id: 'chase', label: '追随' },
  { id: 'side', label: '侧面跟拍' },
  { id: 'cine', label: '电影运镜' },
  { id: 'pov', label: '鹈鹕视角' },
];
let camMode = qp('cam', WPC.cam || 'cine');
if (!CAMS.find((c) => c.id === camMode)) camMode = 'orbit';
const blend = { t: 1, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 42 };
const camTmp = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 42 };
const camOff = new THREE.Vector3();
let cinePov = false;
const _m4 = new THREE.Matrix4();
const _qa = new THREE.Quaternion();
const cine = { shot: 0, t: 0 };
const SHOTS = [
  { d: 6.5, f: (u) => [[lerp(-2.6, 1.4, u), -0.5, 2.0], [0.25, -0.1, 0], 38] },
  { d: 6, f: (u) => [[7.5 - u * 1.2, -0.05, -1.1 + u * 0.5], [0.05, 0.35, 0], 17] },
  { d: 5, f: (u) => [[-0.2 + u * 0.3, -0.5, 0.95], [-0.3, -0.55, 0.05], 34] },
  { d: 7, f: (u) => [[-4.5 + u * 2.5, 1.4 + u * 5, 5 - u * 1.8], [0.3, -0.2, 0], 40] },
  { d: 6, f: (u) => [[2.2 - u * 3, 0.1, -3.4], [0, 0.25, 0], 30] },
  { d: 5, f: () => 'pov' },
  { d: 6.5, f: (u) => [[Math.cos(u * 1.6 + 0.4) * 3.2, 2.6, Math.sin(u * 1.6 + 0.4) * 3.2], [0.2, 0.1, 0], 36] },
  { d: 5.5, f: (u) => [[1.6, 1.6 - u * 0.4, 0.35], [-0.2, 0.35, 0], 55] },
];

function setCamMode(id, quick = false) {
  if (id === camMode && !quick) return;
  camMode = id;
  blend.t = quick ? 1 : 0;
  blend.pos.copy(camera.position);
  blend.quat.copy(camera.quaternion);
  blend.fov = camera.fov;
  if (id === 'orbit') {
    orbitCam.position.copy(camera.position);
    const d = orbitCam.position.distanceTo(focus);
    if (d > 14 || d < 1.2 || orbitCam.position.y < 0.3) orbitCam.position.copy(focus).add(new THREE.Vector3(2.3, 0.45, 3.7));
    controls.target.copy(focus);
    orbitCam.fov = 42;
    orbitCam.updateProjectionMatrix();
    controls.update();
    S.lastOrbitInput = S.time;
  }
  if (id === 'cine') {
    cine.t = 0;
  }
  document.body.classList.toggle('cinematic', id === 'cine');
  document.querySelectorAll('[data-cam]').forEach((b) => b.classList.toggle('on', b.dataset.cam === id));
  const label = CAMS.find((c) => c.id === id)?.label;
  const lbl = $('#camLabel');
  if (lbl) lbl.textContent = label;
}

function povPose(out) {
  const h = pelican.head;
  h.updateWorldMatrix(true, false);
  out.pos.set(0.07, 0.05, 0).applyMatrix4(h.matrixWorld);
  out.look.set(1.2, -0.12, 0).applyMatrix4(h.matrixWorld);
  out.fov = 68;
}

function cameraUpdate(dt) {
  // 焦点：骑手车身中部
  prevFocus.copy(focus);
  focus.set(rider.position.x + 0.05, rider.position.y + 0.92, rider.position.z);
  let fixedPose = true;
  if (camMode === 'orbit') {
    orbitCam.position.add(camTmp.pos.subVectors(focus, prevFocus));
    controls.target.add(camTmp.pos);
    controls.autoRotate = S.time - (S.lastOrbitInput ?? 0) > 7;
    controls.update(dt);
    orbitCam.position.y = Math.max(orbitCam.position.y, groundAt(orbitCam.position) + 0.2);
    camTmp.pos.copy(orbitCam.position);
    camTmp.fov = orbitCam.fov;
    fixedPose = false;
  } else if (camMode === 'chase') {
    camTmp.pos.copy(focus).add(camOff.set(-3.5, 0.7, 1.2 - S.lane * 0.15));
    camTmp.look.copy(focus).add(camOff.set(1.6, 0.05, 0));
    camTmp.fov = 46;
  } else if (camMode === 'side') {
    camTmp.pos.copy(focus).add(camOff.set(0.35 + Math.sin(S.time * 0.2) * 0.5, -0.1, 3.3));
    camTmp.look.copy(focus).add(camOff.set(0.1, -0.05, 0));
    camTmp.fov = 36;
  } else if (camMode === 'pov') {
    povPose(camTmp);
  } else if (camMode === 'cine') {
    cine.t += dt;
    const shot = SHOTS[cine.shot % SHOTS.length];
    if (cine.t > shot.d) {
      cine.t = 0;
      cine.shot = (cine.shot + 1) % SHOTS.length;
      flashCut();
    }
    const cur = SHOTS[cine.shot % SHOTS.length];
    const res = cur.f(cine.t / cur.d);
    cinePov = res === 'pov';
    if (cinePov) povPose(camTmp);
    else {
      const [p, l, f] = res;
      camTmp.pos.set(focus.x + p[0], focus.y + p[1], focus.z + p[2]);
      camTmp.look.set(focus.x + l[0], focus.y + l[1], focus.z + l[2]);
      camTmp.fov = f;
    }
  }
  // 平滑追随 & 防止钻地
  if (fixedPose) {
    if (camMode === 'chase' || camMode === 'side') {
      camera.userData.smooth = camera.userData.smooth || camTmp.pos.clone();
      camera.userData.smooth.x = damp(camera.userData.smooth.x, camTmp.pos.x, 6, dt);
      camera.userData.smooth.y = damp(camera.userData.smooth.y, camTmp.pos.y, 4, dt);
      camera.userData.smooth.z = damp(camera.userData.smooth.z, camTmp.pos.z, 3, dt);
      camTmp.pos.copy(camera.userData.smooth);
    } else camera.userData.smooth = null;
    if (camMode !== 'pov' && !(camMode === 'cine' && cinePov)) camTmp.pos.y = Math.max(camTmp.pos.y, groundAt(camTmp.pos) + 0.12);
    _m4.lookAt(camTmp.pos, camTmp.look, camera.up);
    _qa.setFromRotationMatrix(_m4);
  } else {
    _qa.copy(orbitCam.quaternion);
  }
  if (blend.t < 1) {
    blend.t = Math.min(1, blend.t + dt / 1.3);
    const e = smoothstep(0, 1, blend.t);
    camera.position.copy(blend.pos).lerp(camTmp.pos, e);
    camera.quaternion.copy(blend.quat).slerp(_qa, e);
    camera.fov = lerp(blend.fov, camTmp.fov, e);
  } else {
    camera.position.copy(camTmp.pos);
    camera.quaternion.copy(_qa);
    camera.fov = camTmp.fov;
  }
  camera.updateProjectionMatrix();
}

function groundAt(p) {
  const wx = p.x + S.distance;
  if (Math.abs(p.z) < 2.9) return 0.02;
  if (p.z < SHORE_GUARD) return Math.max(SEA_LEVEL + 0.4, terrainHeight(wx, p.z));
  return terrainHeight(wx, p.z);
}
const SHORE_GUARD = -13;

let flashTimer = 0;
function flashCut() {
  // 壁纸是长时间挂着的画面，每几秒闪一次黑屏太晃眼，这里直接硬切
  if (WP) return;
  const el = $('#cut');
  if (!el) return;
  el.classList.remove('go');
  void el.offsetWidth;
  el.classList.add('go');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => el.classList.remove('go'), 400);
}

// ---------------- 光照与时间 ----------------
const pal = {};
const sunDir = new THREE.Vector3();
const moonDir = new THREE.Vector3();
const env = { night: 0, waveAmp: 1 };
function updateLighting(dt) {
  if (settings.timeFlow && S.started && !S.paused) settings.hour = (settings.hour + dt * settings.dayRate) % 24;
  const hour = settings.hour;
  sunDirection(hour, sunDir);
  moonDirection(hour, moonDir);
  const elev = (Math.asin(clamp(sunDir.y, -1, 1)) * 180) / Math.PI;
  samplePalette(elev, pal);
  const night = nightFactor(elev);
  env.night = night;
  env.waveAmp = settings.waveAmp;
  SKY.uSunDir.value.copy(sunDir);
  SKY.uMoonDir.value.copy(moonDir);
  SKY.uZenith.value.copy(pal.zen);
  SKY.uHorizon.value.copy(pal.hor);
  SKY.uGround.value.copy(pal.gnd);
  SKY.uSunColor.value.copy(pal.sun);
  SKY.uSunGlow.value = 1 - night * 0.9;
  SKY.uNight.value = night;
  SKY.uTime.value = S.t;
  SKY.uCloudCover.value = settings.cloud;
  SKY.uCloudTint.value.copy(pal.ct);
  SKY.uCloudShade.value.copy(pal.cs);
  SKY.uCloudOffset.value.set(S.distance * 0.0009 + S.t * 0.004, S.t * 0.0015);

  // 太阳 / 月光二选一
  const useMoon = elev < -4;
  const lightDir = useMoon ? moonDir : sunDir;
  sun.position.copy(rider.position).addScaledVector(lightDir, 40);
  sun.target.position.copy(rider.position);
  if (useMoon) {
    sun.color.set('#9fb6ff');
    sun.intensity = 0.8 * smoothstep(-4, -12, elev) * clamp(moonDir.y * 3, 0, 1);
  } else {
    sun.color.copy(pal.sun);
    sun.intensity = pal.li;
  }
  hemi.color.copy(pal.hs);
  hemi.groundColor.copy(pal.hg);
  hemi.intensity = pal.hi;
  scene.fog.color.copy(pal.fog);
  scene.fog.density = 0.0052 * settings.fog;
  ocean.uniforms.uFogDensity.value = 0.0036 * settings.fog;
  ocean.uniforms.uDayLight.value = clamp(pal.li / 3 + pal.hi * 0.25, 0.08, 1);
  ocean.uniforms.uOffset.value = S.distance % 36000;
  wavePhases(S.distance, S.t, ocean.uniforms.uPhase.value);
  ocean.uniforms.uAmp.value = settings.waveAmp;
  renderer.toneMappingExposure = pal.exp * settings.exposure;
  scene.environmentIntensity = lerp(1.0, 0.22, night);
  if (bloom) {
    bloom.strength = pal.bloom * settings.bloomBoost * lerp(1, 0.7, night);
    bloom.threshold = lerp(1.05, 0.88, night);
  }
  fillLight.intensity = night * 2.2;
  gradePass.uniforms.uWarm.value = smoothstep(25, 3, elev) * (1 - night) * 0.8;
  // 环境贴图节流刷新
  if (Math.abs(hour - envHour) > 0.18 || envHour < 0) {
    envHour = hour;
    refreshEnv();
  }
  // 路灯点光源
  world.lampPositions(S.distance, lampPos);
  lampLights.forEach((l, i) => {
    l.position.copy(lampPos[i]);
    l.intensity = smoothstep(0.25, 0.75, night) * 18;
  });
  return { elev, night };
}

// ---------------- 骑行物理 ----------------
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const gripL = new THREE.Vector3();
const gripR = new THREE.Vector3();
const lookTarget = new THREE.Vector3();
const pointer = new THREE.Vector2(0, 0);
const raycaster = new THREE.Raycaster();
const rnd = mulberry32(2024);

function updateRide(dt) {
  const up = keys.up;
  const down = keys.down;
  let acc;
  if (S.airborne) acc = -0.15;
  else if (down) acc = -6;
  else if (up) acc = 2.4;
  else acc = (settings.cruise - S.speed) * 0.7;
  if (S.trickT > 0) acc = Math.min(acc, 0.2);
  S.accel = damp(S.accel, acc, 6, dt);
  S.speed = clamp(S.speed + acc * dt, 0, 15.5);
  S.pedaling = !S.airborne && !down && S.speed > 0.25 && acc > -0.4;
  S.distance += S.speed * dt;
  S.wheel += (S.speed / WHEEL_R) * dt;

  // 自动变速：让踏频保持在 ~85 rpm
  const wheelRpm = (S.speed / WHEEL_R) * 60 / TAU;
  if (settings.autoGear && S.time - S.lastGearManual > 8) {
    let best = S.gear;
    let bestErr = 1e9;
    GEARS.forEach(([r, c], i) => {
      const cad = wheelRpm / (r / c);
      const err = Math.abs(cad - 86);
      if (err < bestErr) {
        bestErr = err;
        best = i;
      }
    });
    const curCad = wheelRpm / (GEARS[S.gear][0] / GEARS[S.gear][1]);
    if (best !== S.gear && (curCad > 102 || curCad < 68)) {
      // 换档不再配「咔哒」的链条声：背景层只留风声与海浪声
      S.gear += Math.sign(best - S.gear);
    }
  }
  const ratio = GEARS[S.gear][0] / GEARS[S.gear][1];
  const crankW = S.pedaling ? S.speed / WHEEL_R / ratio : 0;
  S.crank += crankW * dt;
  S.cadence = (crankW * 60) / TAU;

  // 变道 / 自动驾驶
  const steerIn = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  if (steerIn) {
    S.lastSteer = S.time;
    S.laneTarget = clamp(S.laneTarget + steerIn * 2.4 * dt, -2.15, 2.15);
  } else if (settings.autopilot && S.time - S.lastSteer > 4) {
    // 自动巡航：在车道内缓慢游走，看起来像在找乐子
    const want = 0.9 + Math.sin(S.time * 0.23) * 0.85 + Math.sin(S.time * 0.067) * 0.5;
    S.laneTarget = damp(S.laneTarget, clamp(want, -2.15, 2.15), 0.8, dt);
  }
  const k = 10;
  S.laneV += ((S.laneTarget - S.lane) * k - S.laneV * 2 * Math.sqrt(k)) * dt;
  S.lane += S.laneV * dt;
  S.latAcc = damp(S.latAcc, (S.laneV - S.prevLaneV) / Math.max(dt, 1e-3), 8, dt);
  S.prevLaneV = S.laneV;
  const wobble = Math.sin(S.time * 1.7) * 0.02 * clamp(1.5 - S.speed * 0.2, 0.2, 1.5);
  S.lean = damp(S.lean, clamp(Math.atan(S.latAcc / 9.8) * 1.4, -0.4, 0.4) + wobble * 0.5, 7, dt);
  const steerT = S.trickT > 0 ? 0 : -clamp(S.latAcc * 0.05 + S.laneV * 0.12 / Math.max(1, S.speed * 0.3), -0.35, 0.35) + wobble;
  S.steer = damp(S.steer, steerT, 10, dt);

  // 跳跃
  if (S.airborne) {
    S.vy -= 13 * dt;
    S.y += S.vy * dt;
    if (S.y <= 0) {
      S.y = 0;
      S.airborne = false;
      audio.thump();
      burstDust(24);
    }
  }
  // 特技：放手 + 抬前轮
  if (S.trickT > 0) S.trickT -= dt;
  S.trick = damp(S.trick, S.trickT > 0 ? 1 : 0, 4, dt);
  const wheelieT = S.trick * 0.3 + (S.airborne ? S.vy * 0.025 : 0);
  S.wheelie = damp(S.wheelie, wheelieT, 6, dt);

  rider.position.set(0, S.y, S.lane);
  rider.rotation.set(S.lean, -Math.atan2(S.laneV, Math.max(S.speed, 1.5)), 0);
  wheelieRoot.rotation.z = S.wheelie;

  bike.update({ wheelAngle: S.wheel, crankAngle: S.crank, steerAngle: S.steer, speed: S.speed, night: env.night });
  rider.updateMatrixWorld(true);
}

function jump() {
  if (S.airborne || !S.started) return;
  S.airborne = true;
  S.vy = 3.6;
  S.jumps++;
  audio.whoosh();
  unlock('jump');
}
function trick() {
  if (S.trickT > 0 || !S.started) return;
  S.trickT = 3.4;
  S.tricks++;
  pelican.honk();
  audio.honk();
  setTimeout(() => confetti.burst(tmpV.set(0.2, 1.8, S.lane)), 600);
  unlock('trick');
  if (S.tricks >= 3) unlock('trick3');
}
function ringBell() {
  audio.bell();
  S.bells++;
  if (S.bells >= 10) unlock('bell10');
  const b = bike.anchors.bell;
  b.scale.setScalar(1.25);
  setTimeout(() => b.scale.setScalar(1), 120);
}
function honk() {
  pelican.honk();
  audio.honk();
  S.honks++;
  unlock('honk');
}

const white = new THREE.Color('#ffffff');

// 跃出海面的鱼（点击海面或随机）
function launchJumper(x, z) {
  const j = jumpers.find((q) => q.t < 0);
  if (!j) return;
  j.t = 0;
  j.x = x + S.distance;
  j.z = z;
  j.dur = 1.0 + rnd() * 0.5;
  j.h = 1.2 + rnd() * 1.3;
  j.dir = rnd() < 0.5 ? 1 : -1;
  j.mesh.visible = true;
  splashAt(x, z, 26);
  // 鱼跃不出声：水花是 400–2400Hz 的宽带噪声，而背景层（海浪 / 风声 / 胎噪）全在 600Hz 以下，
  // 它是整个背景里唯一的高频事件，每几秒响一次像在「噼里啪啦」。画面保留，声音去掉。
}
function splashAt(x, z, n) {
  const y = waveHeight(x + S.distance, z, S.t, settings.waveAmp);
  for (let i = 0; i < n; i++) {
    const a = rnd() * TAU;
    const sp = 0.5 + rnd() * 1.5;
    tmpV.set(x, y + 0.05, z);
    tmpV2.set(Math.cos(a) * sp, 2 + rnd() * 2.5, Math.sin(a) * sp);
    splash.emit(tmpV, tmpV2, white, 0.06 + rnd() * 0.06, 0.8 + rnd() * 0.5, { drag: 0.6, grav: 9.8, ground: 1 });
  }
}
function updateJumpers(dt) {
  for (const j of jumpers) {
    if (j.t < 0) continue;
    j.t += dt;
    const u = j.t / j.dur;
    const x = j.x - S.distance + (u - 0.5) * 1.6 * j.dir;
    const base = waveHeight(j.x, j.z, S.t, settings.waveAmp);
    const y = base + Math.sin(u * Math.PI) * j.h - 0.2;
    j.mesh.position.set(x, y, j.z);
    j.mesh.rotation.set(0, j.dir > 0 ? 0 : Math.PI, (0.5 - u) * 2.4);
    if (u >= 1) {
      j.t = -1;
      j.mesh.visible = false;
      splashAt(x, j.z, 18);
      // 落水同样不出声，理由见 launchJumper
    }
  }
}

function burstDust(n) {
  const c = new THREE.Color('#cdbb9a');
  for (let i = 0; i < n; i++) {
    tmpV.set(BIKE_POINTS.rearHub.x + (rnd() - 0.5) * 0.3, 0.03, S.lane + (rnd() - 0.5) * 0.25);
    tmpV2.set((rnd() - 0.5) * 1.5, rnd() * 0.9, (rnd() - 0.5) * 1.5);
    dust.emit(tmpV, tmpV2, c, 0.12 + rnd() * 0.12, 0.8 + rnd() * 0.6, { drag: 1.5, grav: -0.1, ground: 1 });
  }
}
const dustCol = new THREE.Color('#b9ab92');
let dustAcc = 0;
function emitDust(dt) {
  if (S.airborne || S.speed < 3.5) return;
  dustAcc += dt * S.speed * 1.4;
  while (dustAcc > 1) {
    dustAcc -= 1;
    tmpV.set(BIKE_POINTS.rearHub.x - 0.05 - rnd() * 0.1, 0.02, S.lane + (rnd() - 0.5) * 0.08);
    tmpV2.set(-0.3 - rnd() * 0.6, 0.15 + rnd() * 0.35, (rnd() - 0.5) * 0.4);
    dust.emit(tmpV, tmpV2, dustCol, 0.03 + rnd() * 0.04, 0.5 + rnd() * 0.4, { drag: 1.2, grav: -0.05, ground: 1 });
  }
}

// ---------------- 鹈鹕看向 ----------------
let glanceT = 0;
let glanceKind = 0;
function computeLook(dt) {
  if (settings.lookMouse && S.time - S.lastPointer < 2.5 && camMode !== 'pov') {
    raycaster.setFromCamera(pointer, camera);
    const d = camera.position.distanceTo(focus);
    lookTarget.copy(raycaster.ray.origin).addScaledVector(raycaster.ray.direction, d);
  } else {
    glanceT -= dt;
    if (glanceT <= 0) {
      glanceKind = (glanceKind + 1) % 4;
      glanceT = glanceKind === 0 ? 3.5 : 2.2;
    }
    if (glanceKind === 1 && camMode !== 'pov') lookTarget.copy(camera.position);
    else if (glanceKind === 3) lookTarget.set(rider.position.x + 2, 1.2, -8);
    else lookTarget.set(rider.position.x + 6, 1.15, rider.position.z);
  }
  return pelican.root.worldToLocal(lookTarget);
}

// ---------------- 成就 / 提示 ----------------
const ACH = {
  jump: ['🦘', '起飞！', '第一次跳跃'],
  trick: ['🪽', '放手特技', '展翅 + 抬前轮'],
  trick3: ['🎪', '杂技鹈鹕', '完成 3 次特技'],
  speed30: ['💨', '时速 30', '风在耳边呼啸'],
  speed45: ['⚡', '疾风鹈鹕', '时速突破 45 km/h'],
  km1: ['🛣️', '骑行 1 公里', '海岸线才刚开始'],
  km5: ['🗺️', '骑行 5 公里', '真正的长途鹈鹕'],
  night: ['🌙', '夜骑', '星光与路灯作伴'],
  bell10: ['🔔', '铃铃铃', '按铃 10 次，路人已让开'],
  honk: ['📢', '嘎——！', '鹈鹕的呐喊'],
};
function unlock(id) {
  if (achieved.has(id) || !S.started) return;
  achieved.add(id);
  const [emo, title, sub] = ACH[id];
  toast(emo, title, sub);
  $('#achCount').textContent = `${achieved.size}/${Object.keys(ACH).length}`;
  if (['speed45', 'km1', 'trick3', 'km5'].includes(id)) confetti.burst(tmpV.set(0.3, 1.9, S.lane));
}
function toast(emo, title, sub) {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span class="emo">${emo}</span><div><b>${title}</b><small>${sub}</small></div>`;
  box.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => {
    el.classList.remove('in');
    setTimeout(() => el.remove(), 500);
  }, 3200);
}

// ---------------- HUD ----------------
const hud = {
  speed: $('#speedVal'),
  arc: $('#speedArc'),
  cad: $('#cadVal'),
  gear: $('#gearVal'),
  dist: $('#distVal'),
  clock: $('#clockVal'),
  fps: $('#fps'),
  sunIcon: $('#sunIcon'),
};
const ARC_LEN = 2 * Math.PI * 52 * 0.75;
let hudAcc = 0;
let fpsAcc = 0;
let fpsFrames = 0;
let fpsVal = 60;
let lastFrameT = performance.now();
function updateHud(dt, info) {
  const now = performance.now();
  const realDt = Math.min(0.25, (now - lastFrameT) / 1000);
  lastFrameT = now;
  if (!S.paused) {
    fpsAcc += realDt;
    fpsFrames++;
  }
  if (fpsAcc > 0.5) {
    fpsVal = fpsFrames / fpsAcc;
    fpsAcc = 0;
    fpsFrames = 0;
    adaptQuality(fpsVal);
  }
  hudAcc += dt;
  if (hudAcc < 0.1) return;
  hudAcc = 0;
  if (WP && !NP) return; // 壁纸模式界面全隐藏，不用每 0.1 秒写一遍这些 DOM
  const kmh = S.speed * 3.6;
  hud.speed.textContent = kmh.toFixed(0);
  hud.arc.style.strokeDashoffset = `${ARC_LEN * (1 - clamp(kmh / 55, 0, 1))}`;
  hud.cad.textContent = S.cadence.toFixed(0);
  hud.gear.textContent = `${S.gear + 1}/${GEARS.length}`;
  hud.dist.textContent = (S.distance / 1000).toFixed(2);
  const h = Math.floor(settings.hour);
  const m = Math.floor((settings.hour - h) * 60);
  hud.clock.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  refreshTimeHighlight();
  hud.sunIcon.textContent = info.night > 0.5 ? '🌙' : info.elev < 8 ? '🌅' : '☀️';
  hud.fps.textContent = `${fpsVal.toFixed(0)} FPS · ${quality.name} · ${renderer.getPixelRatio().toFixed(2)}x`;
  hud.fps.hidden = !settings.showFps;
  if (kmh >= 30) unlock('speed30');
  if (kmh >= 45) unlock('speed45');
  if (S.distance >= 1000) unlock('km1');
  if (S.distance >= 5000) unlock('km5');
  if (info.night > 0.8 && S.started && S.time > 5) unlock('night');
}

// 自适应分辨率：按真实时间测帧率；以观测到的刷新上限为基准（兼容 30fps 锁帧），记住失败过的像素比上限
let lowStreak = 0;
let highStreak = 0;
let refreshCap = 0;
let prCeiling = Infinity;
function adaptQuality(fps) {
  if (!S.started || document.hidden || S.paused) return;
  refreshCap = Math.max(refreshCap * 0.995, fps);
  const pr = renderer.getPixelRatio();
  const lowT = Math.min(40, refreshCap * 0.72);
  if (fps < lowT) lowStreak++;
  else lowStreak = 0;
  if (fps > refreshCap * 0.93) highStreak++;
  else highStreak = 0;
  if (lowStreak >= 4 && pr > 0.6) {
    prCeiling = pr - 0.01;
    setPixelRatio(Math.max(0.6, pr - 0.2));
    lowStreak = 0;
    highStreak = 0;
  } else if (highStreak >= 16 && pr < Math.min(quality.pr, prCeiling) - 0.01) {
    setPixelRatio(Math.min(quality.pr, prCeiling, pr + 0.1));
    highStreak = 0;
  }
}
function setPixelRatio(pr) {
  renderer.setPixelRatio(pr);
  composer.setPixelRatio(pr);
  composer.setSize(innerWidth, innerHeight);
}
function applyQuality(key) {
  prCeiling = Infinity;
  qualityKey = key;
  quality = QUALITY[key];
  renderer.setPixelRatio(quality.pr);
  sun.shadow.mapSize.set(quality.shadow, quality.shadow);
  if (sun.shadow.map) {
    sun.shadow.map.dispose();
    sun.shadow.map = null;
  }
  buildComposer();
}

// ---------------- 输入 ----------------
const KEYMAP = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
};
addEventListener('keydown', (e) => {
  if (WP && !NP) return; // 壁纸模式不接键盘（新标签页要接：W/S 加减速、A/D 变道、空格跳、T 特技）
  // 焦点在界面控件上时不接管键盘。新标签页那层（搜索框、快捷网址、右上角树叶）全靠这一条，
  // 漏了就会一边骑车一边往搜索框里输字。
  const tgt = e.target;
  if (
    tgt instanceof HTMLInputElement ||
    tgt instanceof HTMLTextAreaElement ||
    tgt instanceof HTMLSelectElement ||
    tgt instanceof HTMLAnchorElement ||
    tgt instanceof HTMLButtonElement ||
    tgt?.isContentEditable
  )
    return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = KEYMAP[e.code];
  if (k) {
    keys[k] = true;
    e.preventDefault();
  }
  if (e.repeat) return;
  switch (e.code) {
    case 'Space':
      e.preventDefault();
      jump();
      break;
    case 'KeyB':
      ringBell();
      break;
    case 'KeyT':
      trick();
      break;
    case 'KeyH':
      honk();
      break;
    case 'KeyC': {
      const i = CAMS.findIndex((c) => c.id === camMode);
      setCamMode(CAMS[(i + 1) % CAMS.length].id);
      break;
    }
    case 'KeyN':
      cycleTimeOfDay();
      break;
    case 'KeyQ':
      S.gear = Math.max(0, S.gear - 1);
      S.lastGearManual = S.time;
      break;
    case 'KeyE':
      S.gear = Math.min(GEARS.length - 1, S.gear + 1);
      S.lastGearManual = S.time;
      break;
    case 'KeyM':
      toggleMusic();
      break;
    case 'KeyK':
      wantShot = true;
      break;
    case 'KeyF':
      toggleFullscreen();
      break;
    case 'KeyU':
      document.body.classList.toggle('hide-ui');
      break;
    case 'KeyP':
      S.paused = !S.paused;
      audio.mute(S.paused);
      toast(S.paused ? '⏸' : '▶️', S.paused ? '已暂停' : '继续骑行', '按 P 切换');
      break;
    default:
      break;
  }
});
addEventListener('keyup', (e) => {
  const k = KEYMAP[e.code];
  if (k) keys[k] = false;
  // macOS 按住 Cmd 时不会发送其它键的 keyup
  if (e.key === 'Meta') for (const key of Object.keys(keys)) keys[key] = false;
});
addEventListener('blur', () => {
  for (const k of Object.keys(keys)) keys[k] = false;
});

const down = { x: 0, y: 0, t: 0 };
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (WP && !NP) return;
  down.x = e.clientX;
  down.y = e.clientY;
  down.t = performance.now();
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (WP && !NP) return;
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  S.lastPointer = S.time;
  // 在其它镜头下拖拽，自动切到自由环绕
  if (e.buttons && camMode !== 'orbit' && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) setCamMode('orbit');
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (WP && !NP) return;
  if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6 || performance.now() - down.t > 450) return;
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hitBell = raycaster.intersectObject(bike.anchors.bell, true);
  if (hitBell.length) return ringBell();
  const hitBird = raycaster.intersectObjects(pelican.hitMeshes, false);
  if (hitBird.length) return honk();
  const hitBike = raycaster.intersectObject(bike.group, true);
  if (hitBike.length) return ringBell();
  const hitSea = raycaster.intersectObject(ocean.mesh, false);
  if (hitSea.length) {
    const p = hitSea[0].point;
    if (p.z < -12) launchJumper(p.x, p.z);
  }
});

// 触屏按钮
document.querySelectorAll('[data-key]').forEach((b) => {
  const k = b.dataset.key;
  const on = (e) => {
    e.preventDefault();
    keys[k] = true;
    b.classList.add('on');
  };
  const off = () => {
    keys[k] = false;
    b.classList.remove('on');
  };
  b.addEventListener('pointerdown', on);
  b.addEventListener('pointerup', off);
  b.addEventListener('pointerleave', off);
  b.addEventListener('pointercancel', off);
});
const ACTIONS = {
  jump,
  trick,
  bell: ringBell,
  honk,
  shot: () => (wantShot = true),
  music: () => toggleMusic(),
  env: () => toggleEnv(),
  full: () => toggleFullscreen(),
  gui: () => toggleGui(),
  help: () => $('#help').classList.toggle('show'),
  share: () => shareView(),
  time: () => cycleTimeOfDay(),
  upload: () => openMusicPicker(),
};
document.querySelectorAll('[data-act]').forEach((b) => {
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    ACTIONS[b.dataset.act]?.();
  });
});
document.querySelectorAll('[data-cam]').forEach((b) => b.addEventListener('click', () => setCamMode(b.dataset.cam)));
document.querySelectorAll('[data-time]').forEach((b) => b.addEventListener('click', () => setTimeOfDay(b.dataset.time)));

// ---------------- 新标签页控制条（浏览器插件专用） ----------------
// 时段 / 动作 / 镜头按钮用的就是 HUD 那一套 data-time / data-act / data-cam 标记，
// 上面几行 querySelectorAll 已经把事件绑好了（高亮同步也是），这里只补速度滑块和声音开关。
if (NP) {
  const speed = $('#npSpeed');
  const speedVal = $('#npSpeedVal');
  if (speed && speedVal && NP.speed) {
    speed.value = String(clamp(settings.kph > 0 ? settings.kph : settings.cruise * 3.6, +speed.min, +speed.max));
    const sync = () => {
      speedVal.textContent = (+speed.value).toFixed(1);
    };
    speed.addEventListener('input', () => {
      setCruiseKph(+speed.value);
      sync();
    });
    sync();
  }
  // 声音默认关着：新标签页动不动就出声很烦，点一下才启动音频（顺便满足浏览器的自动播放策略）
  const snd = $('#npSound');
  if (snd && NP.sound) {
    let soundOn = false;
    snd.addEventListener('click', () => {
      soundOn = !soundOn;
      if (soundOn) ensureAudio();
      audio.setVolume(soundOn ? settings.volume : 0);
      snd.classList.toggle('on', soundOn);
      toast(soundOn ? '🔊' : '🔇', soundOn ? '声音：开' : '声音：关', NP ? '海浪与风声的大小拖旁边的「海浪」滑块' : '音乐、海浪风声可在参数面板 → 声音里细调');
    });
  }
  // 海浪 / 风声音量：插件的参数面板是藏起来的（html.wp 下 #guiHost 不显示），
  // 所以这个滑块是新标签页里唯一能细调环境音的地方。拖到 0 等于静音。
  const env = $('#npEnv');
  const envVal = $('#npEnvVal');
  if (env && envVal && NP.sound) {
    env.value = String(settings.envVolume);
    const syncEnv = () => {
      envVal.textContent = String(Math.round(+env.value * 100));
    };
    env.addEventListener('input', () => {
      ensureAudio(); // 拖动也算用户手势，可以借此启动音频
      settings.envVolume = +env.value;
      settings.envOn = settings.envVolume > 0;
      audio.setEnvVolume(settings.envVolume);
      audio.setEnv(settings.envOn);
      setEnvButton();
      syncEnv();
    });
    syncEnv();
  }
  // 快捷键一览：鼠标悬浮出来、点一下钉住。浮窗不在按钮里（见 index.template.html 的说明），
  // 所以不能靠 CSS :hover 相邻判断——移开时给 180ms 宽限，够鼠标从按钮挪到浮窗上。
  // 宽限到点后重新判一次「鼠标还在不在」，而不是靠 enter 去 clearTimeout：
  // 同一次 mousemove 里 leave(按钮) 和 enter(浮窗) 谁先谁后由浏览器定，靠时序会翻车。
  const keysBtn = $('#npKeys');
  const keysTip = $('#npKeysTip');
  if (NP.keys && keysBtn && keysTip) {
    let hideTimer = 0;
    let pinned = false;
    const hovering = () => keysBtn.matches(':hover') || keysTip.matches(':hover');
    const paint = (open) => {
      keysTip.classList.toggle('show', open);
      keysBtn.setAttribute('aria-expanded', String(open));
    };
    const sync = () => paint(pinned || hovering());
    const openKeys = () => {
      clearTimeout(hideTimer);
      sync();
    };
    const closeKeys = () => {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(sync, 180);
    };
    // 手动关掉：忽略「鼠标还停在上面」（点一下收起来、按 Esc 收起来，都要真的收掉）
    const forceClose = () => {
      clearTimeout(hideTimer);
      paint(false);
    };
    keysBtn.addEventListener('mouseenter', openKeys);
    keysBtn.addEventListener('mouseleave', closeKeys);
    keysBtn.addEventListener('focus', openKeys);
    keysBtn.addEventListener('blur', closeKeys);
    keysTip.addEventListener('mouseenter', openKeys);
    keysTip.addEventListener('mouseleave', closeKeys);
    keysBtn.addEventListener('click', () => {
      pinned = !pinned;
      if (pinned) openKeys();
      else forceClose();
    });
    // 钉住之后点别处就收起来，免得挡着画面又找不到关的地方
    addEventListener(
      'pointerdown',
      (e) => {
        if (!pinned || keysTip.contains(e.target) || keysBtn.contains(e.target)) return;
        pinned = false;
        forceClose();
      },
      true,
    );
    addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !pinned) return;
      pinned = false;
      forceClose();
      keysBtn.blur();
    });
  }
  // 配置里关掉的组直接藏起来（默认全开）
  for (const [key, cls] of Object.entries({ speed: '.np-speed', tod: '.np-tod', keys: '.np-keys, .np-keys-tip', acts: '.np-acts', cams: '.np-cams', sound: '.np-sound' })) {
    if (!NP[key]) for (const sel of cls.split(', ')) $(`#npbar ${sel}`)?.setAttribute('hidden', '');
  }
}

function ensureAudio() {
  if (!audio.ctx) {
    audio.start();
    audio.setVolume(settings.volume);
    audio.setEnvVolume(settings.envVolume);
    audio.setEnv(settings.envOn);
    audio.setMusic(settings.music);
    audio.setMusicVolume(settings.musicVolume);
  }
}
addEventListener('pointerdown', () => {
  const st = audio.ctx?.state;
  if (st && st !== 'running' && st !== 'closed' && !document.hidden && !S.paused) audio.ctx.resume();
});
function setMusicButton() {
  $('[data-act="music"]')?.classList.toggle('off', !settings.music);
}
function toggleMusic() {
  settings.music = !settings.music;
  // 静音进入后再打开音乐：此时有用户手势，可以启动音频
  if (settings.music) ensureAudio();
  audio.setMusic(settings.music);
  audio.setMusicVolume(settings.musicVolume);
  setMusicButton();
}
document.addEventListener('visibilitychange', () => audio.mute(document.hidden || S.paused));

// 海浪 / 风声：HUD 上一个开关，参数面板里还能细调音量
function setEnvButton() {
  $('[data-act="env"]')?.classList.toggle('off', !settings.envOn);
}
function toggleEnv() {
  settings.envOn = !settings.envOn;
  if (settings.envOn) ensureAudio(); // 这里一定处于用户手势里，可以启动音频
  audio.setEnv(settings.envOn);
  setEnvButton();
  toast(settings.envOn ? '🌊' : '🔇', settings.envOn ? '海浪与风声：开' : '海浪与风声：关', '音量可在参数面板 → 声音 里调');
}
setEnvButton();

// ---------------- 自定义背景音乐（用户上传 MP3） ----------------
const musicInput = document.createElement('input');
musicInput.type = 'file';
musicInput.accept = 'audio/*,.mp3,.m4a,.aac,.wav,.ogg,.flac';
musicInput.multiple = true;
musicInput.style.display = 'none';
document.body.appendChild(musicInput);
musicInput.addEventListener('change', () => {
  const files = [...musicInput.files];
  musicInput.value = '';
  if (!files.length) return;
  ensureAudio(); // 静音进入也能用：这里一定处于用户手势里
  if (!audio.loadCustomMusic(files)) {
    toast('🎧', '这个文件读不了', '换一个 MP3 / M4A / WAV 试试');
    return;
  }
  settings.musicCustom = true;
  settings.music = true;
  settings.trackName = audio.trackName || files[0].name;
  audio.setVolume(settings.volume);
  audio.setMusicVolume(settings.musicVolume);
  audio.setMusic(true);
  setMusicButton();
  toast('🎧', '已经换成你的音乐', `${files.length} 首，循环播放`);
});
function openMusicPicker() {
  ensureAudio();
  musicInput.click();
}
function useCustomMusic(on) {
  ensureAudio();
  audio.setCustomOn(on);
  settings.musicCustom = on;
}
function clearCustomMusic() {
  audio.clearCustomMusic();
  settings.musicCustom = false;
  settings.trackName = '未选择（用内置生成式音乐）';
}
function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
}
function shareView() {
  const u = new URL(location.href);
  u.search = '';
  u.searchParams.set('time', settings.hour.toFixed(2));
  u.searchParams.set('tod', settings.timeOfDay);
  u.searchParams.set('cam', camMode);
  if (!settings.envOn || Math.abs(settings.envVolume - 0.5) > 0.001) {
    u.searchParams.set('env', settings.envVolume.toFixed(2));
    u.searchParams.set('envon', settings.envOn ? '1' : '0');
  }
  navigator.clipboard?.writeText(u.toString()).then(
    () => toast('🔗', '已复制分享链接', '打开即回到当前时刻与镜头'),
    () => toast('🔗', '分享链接', u.toString()),
  );
}

// ---------------- 截图 ----------------
let wantShot = false;
function takeShot() {
  renderer.domElement.toBlob((b) => {
    if (!b) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = `pelican-ride-${Date.now()}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('📸', '截图已保存', '分享你的鹈鹕骑行瞬间');
  });
}

// ---------------- GUI ----------------
const gui = new GUI({ title: '⚙️ 参数面板', container: $('#guiHost') });
gui.hide();
const f1 = gui.addFolder('骑行');
f1.add(settings, 'cruise', 0, 14, 0.5).name('巡航速度 m/s');
f1.add(settings, 'autopilot').name('自动巡航（自动变道）');
f1.add(settings, 'autoGear').name('自动变速');
const f2 = gui.addFolder('时间与天气');
f2.add(settings, 'timeOfDay', { 清晨: 'morning', 白天: 'day', 傍晚: 'dusk', 晚上: 'night' })
  .name('时段（手动）')
  .listen()
  .onChange(setTimeOfDay);
f2.add(settings, 'hour', 0, 24, 0.01).name('时刻微调').listen().onChange(refreshTimeHighlight);
f2.add(settings, 'timeFlow').name('时间自动流动').listen();
f2.add(settings, 'dayRate', 0, 0.5, 0.005).name('流速 (时/秒)');
f2.add(settings, 'cloud', 0, 0.9, 0.01).name('云量');
f2.add(settings, 'waveAmp', 0, 2.2, 0.05).name('浪高');
f2.add(settings, 'fog', 0.6, 3, 0.05).name('雾浓度');
const f3 = gui.addFolder('画面');
f3.add(settings, 'quality', { 流畅: 'low', 均衡: 'medium', 精美: 'high', 极致: 'ultra' }).name('画质').onChange(applyQuality);
f3.add(settings, 'bloom').name('泛光').onChange((v) => (bloom.enabled = v && quality.bloom));
f3.add(settings, 'bloomBoost', 0, 3, 0.05).name('泛光强度');
f3.add(settings, 'exposure', 0.4, 2, 0.01).name('曝光');
f3.add(settings, 'showFps').name('显示帧率');
const f4 = gui.addFolder('鹈鹕');
f4.add(settings, 'helmet').name('头盔');
f4.add(settings, 'glasses', { 自动: 'auto', 戴上: 'on', 摘下: 'off' }).name('墨镜');
f4.add(settings, 'scarf').name('围巾').onChange((v) => (scarf.mesh.visible = v));
f4.add(settings, 'lookMouse').name('目光跟随鼠标');
const f5 = gui.addFolder('声音');
f5.add(settings, 'volume', 0, 1, 0.01).name('主音量').onChange((v) => {
  ensureAudio();
  audio.setVolume(v);
});
// 海浪 / 风声背景音：可以单独调小，也可以整块关掉
f5.add(settings, 'envVolume', 0, 1, 0.01).name('海浪 / 风声音量').onChange((v) => {
  ensureAudio();
  audio.setEnvVolume(v);
});
f5.add(settings, 'envOn').name('海浪与风声').listen().onChange((v) => {
  ensureAudio();
  audio.setEnv(v);
});
f5.add(settings, 'music').name('音乐开关').listen().onChange((v) => {
  ensureAudio();
  audio.setMusic(v);
  setMusicButton();
});
f5.add(settings, 'musicVolume', 0, 1, 0.01).name('音乐音量').onChange((v) => {
  ensureAudio();
  audio.setMusicVolume(v);
});
f5.add(settings, 'musicCustom').name('使用自定义音乐').listen().onChange((v) => useCustomMusic(v));
f5.add({ pick: openMusicPicker }, 'pick').name('上传背景音乐（MP3）');
f5.add({ clear: clearCustomMusic }, 'clear').name('清除自定义音乐');
f5.add(settings, 'trackName').name('当前曲目').listen().disable();
for (const f of [f2, f3, f4, f5]) f.close();
function toggleGui() {
  if (gui._hidden) {
    gui.show();
    gui.open();
  } else gui.hide();
  $('[data-act="gui"]').classList.toggle('on', !gui._hidden);
}

// ---------------- 开场 ----------------
function start(withSound) {
  if (S.started) return;
  S.started = true;
  document.body.classList.add('started');
  if (withSound) {
    audio.start();
    audio.setVolume(settings.volume);
    audio.setMusicVolume(settings.musicVolume);
  }
  setCamMode(Q.has('cam') ? camMode : WP ? WPC.cam || 'cine' : 'orbit'); // 壁纸默认电影运镜
  // 新标签页开着桌面层（时钟/搜索/快捷网址）时不弹这条：每开一次标签页就冒一条提示太吵，
  // 而且底部那排控件和快捷网址本身就摆在明面上，不需要再说一遍
  if (!WP) setTimeout(() => toast('🐦', '出发！', isTouch ? '点屏幕按钮加速、变道、跳跃' : 'W/S 加减速 · A/D 变道 · 空格跳 · T 特技'), 900);
  else if (NP && !WPC.home)
    setTimeout(
      () => toast('🐦', '新标签页里骑行中', `下面一排能调速、切时段、做动作${isTouch ? '' : '；键盘 W/S/A/D、空格跳、T 特技也能用'}`),
      900,
    );
}
$('#startBtn').addEventListener('click', () => start(true));
$('#startMute').addEventListener('click', () => {
  settings.music = false;
  $('[data-act="music"]').classList.add('off');
  start(false);
});
// 壁纸模式：不要开场遮罩、不要声音，直接开始骑
if (WP || qp('autostart', '0') === '1') start(false);
setCamMode(camMode, true);

// ---------------- 主循环 ----------------
const timer = new THREE.Timer();
timer.connect(document);
const windV = new THREE.Vector3();
const scarfA = new THREE.Vector3();
const scarfB = new THREE.Vector3();
const bodyW = new THREE.Vector3();
const collider = { center: bodyW, radius: 0.25 };
let info = { elev: 10, night: 0 };
const fixedDt = qp('dt', '');
const bufSize = new THREE.Vector2();

let wpLastDraw = -1e9;

// 一帧的模拟推进（不含渲染与 HUD）：主循环和「壁纸首帧前预热」共用同一套
function step(dt) {
  S.t += dt;
  S.time += dt;

  updateRide(dt);
  info = updateLighting(dt);
  world.update(S.distance, dt, S.t, env);

  // 骑手 IK 与动画
  bike.group.updateMatrixWorld(true);
  const steerM = bike.steerMatrix();
  gripL.copy(bike.anchors.gripL.position).applyMatrix4(steerM);
  gripR.copy(bike.anchors.gripR.position).applyMatrix4(steerM);
  const glasses = settings.glasses === 'auto' ? info.night < 0.3 : settings.glasses === 'on';
  pelican.update(dt, {
    t: S.t,
    crankAngle: S.crank,
    pedal: S.pedaling ? 1 : 0.3,
    airborne: S.airborne ? 1 : 0,
    trick: S.trick,
    accel: S.accel,
    look: computeLook(dt),
    grips: { L: gripL, R: gripR },
    pedals: { L: bike.anchors.pedalL.position, R: bike.anchors.pedalR.position },
    helmet: settings.helmet,
    glasses,
  });
  pelican.root.updateMatrixWorld(true);

  // 围巾：根部取脖子结的后侧
  if (settings.scarf) {
    const kp = pelican.knot.position;
    scarfA.set(kp.x - 0.07, kp.y + 0.025, 0.01);
    scarfB.set(kp.x - 0.07, kp.y - 0.04, -0.01);
    pelican.root.localToWorld(scarfA);
    pelican.root.localToWorld(scarfB);
    pelican.body.getWorldPosition(bodyW);
    windV.set(-S.speed + Math.sin(S.t * 0.7) * 0.8, S.airborne ? -S.vy * 0.6 : 0.3, -S.laneV * 0.8 + Math.sin(S.t * 0.4) * 0.6);
    if (dt > 0) scarf.update(dt, scarfA, scarfB, windV, S.t, collider);
  }
  pelican.knot.visible = settings.scarf;

  updateJumpers(dt);
  emitDust(dt);
  if (S.started && rnd() < dt * 0.12) launchJumper(8 + rnd() * 30, -20 - rnd() * 25);
  const scroll = S.speed * dt;
  dust.update(dt, scroll);
  sparkles.update(dt, 0);
  splash.update(dt, scroll);
  confetti.update(dt, scroll);
  speedLines.update(dt, S.speed, camMode === 'pov' || camMode === 'chase' ? 1 : 0.6);

  cameraUpdate(dt);
  sky.mesh.position.copy(camera.position);
  renderer.getDrawingBufferSize(bufSize);
  const scale = bufSize.y / (2 * Math.tan((camera.fov * Math.PI) / 360));
  dust.uniforms.uScale.value = scale;
  sparkles.uniforms.uScale.value = scale;
  splash.uniforms.uScale.value = scale;
  world.ffMat.uniforms.uScale.value = scale;

  gradePass.uniforms.uTime.value = S.t;
  gradePass.uniforms.uAberration.value = clamp((S.speed - 9) / 6, 0, 1) * 0.012 + (S.airborne ? 0.004 : 0);

  audio.update({ speed: S.speed, pedaling: S.pedaling, night: info.night, cadence: S.cadence, airborne: S.airborne });
}

function frame(ts) {
  // 壁纸锁帧：没到下一帧的时间点就跳过去，等于把 60Hz 的 rAF 压到 30fps，省电也不影响观感
  if (WP_GAP && ts - wpLastDraw < WP_GAP - 1) {
    requestAnimationFrame(frame);
    return;
  }
  wpLastDraw = ts;
  timer.update(ts);
  let dt = Math.min(timer.getDelta(), 1 / 20);
  if (fixedDt) dt = +fixedDt;
  if (S.paused) dt = 0;
  step(dt);
  updateHud(dt, info);

  composer.render();
  if (wantShot) {
    wantShot = false;
    takeShot();
  }
  requestAnimationFrame(frame);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  orbitCam.aspect = camera.aspect;
  camera.updateProjectionMatrix();
  orbitCam.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  bloom.resolution.set(innerWidth / 2, innerHeight / 2);
});

// 首帧前预热一次，避免开场卡顿
world.update(0, 0, 0, env);
refreshEnv();
// 壁纸是长时间挂着的画面，第一帧就要是「骑了一会儿」的样子：
// 空推 3 秒，让围巾、坐姿 IK、锁定的镜头位置、粒子都落到稳态，避免刚进入时那一下晃动。
if (WP) for (let i = 0; i < 180; i++) step(1 / 60);
requestAnimationFrame(frame);
$('#loading')?.remove();
document.body.classList.add('ready');

// 调试接口（自动化测试截图使用）
window.__pelican = {
  pelican,
  bike,
  view(dx, dy, dz, fov = 35, lx = 0, ly = 0, lz = 0) {
    setCamMode('orbit', true);
    controls.autoRotate = false;
    S.lastOrbitInput = 1e9;
    orbitCam.position.set(focus.x + dx, focus.y + dy, focus.z + dz);
    controls.target.set(focus.x + lx, focus.y + ly, focus.z + lz);
    orbitCam.fov = fov;
    orbitCam.updateProjectionMatrix();
    controls.update();
  },
  S,
  settings,
  setCamMode,
  setTimeOfDay,
  TIME_PRESETS,
  NP,
  setCruiseKph,
  jump,
  trick,
  honk,
  ringBell,
  launchJumper,
  audio,
  cine,
  renderer,
  get fps() {
    return fpsVal;
  },
};
