// 纯 WebAudio 合成：无任何音频文件
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.musicOn = true;
    this.params = { speed: 0, pedaling: true, night: 0, cadence: 0 };
    this.volume = 0.8;
    this.musicVolume = 0.55;
    this.sfxVolume = 0.9;
    // 环境音（海浪 + 风声）单独控制：0 就是彻底关掉
    this.envVolume = 0.5;
    this.envOn = true;
    // 自定义背景音乐（用户上传）
    this.tracks = [];
    this.trackIdx = 0;
    this.customOn = false;
    this.customEl = null;
    this.customSrc = null;
    this.customGain = null;
    this.trackName = '';
  }

  start() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);

    // 混响总线
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.8, 2.2);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.35;
    this.reverb.connect(this.reverbGain).connect(this.master);

    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.sfxVolume;
    this.sfx.connect(this.master);

    // 音乐总线：生成式与自定义音乐共用一个低通，削掉刺耳高频，整体更柔和
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 2400;
    this.musicFilter.Q.value = 0.3;
    this.musicFilter.connect(this.master);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicOn ? this.musicVolume : 0;
    this.musicBus.connect(this.musicFilter);
    const mSend = ctx.createGain();
    mSend.gain.value = 0.5;
    this.musicBus.connect(mSend).connect(this.reverb);

    this.noise = this.noiseBuffer();
    this.brown = this.brownBuffer();

    // 环境音总线：海浪与风声都从这里过，方便整体调音量或一键关掉
    this.envBus = ctx.createGain();
    this.envBus.gain.value = this.envOn ? this.envVolume : 0;
    this.envBus.connect(this.sfx);

    // 风声
    this.wind = this.loop(this.noise);
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.wind.connect(this.windFilter).connect(this.windGain).connect(this.envBus);

    // 胎噪
    this.roll = this.loop(this.brown);
    this.rollFilter = ctx.createBiquadFilter();
    this.rollFilter.type = 'lowpass';
    this.rollFilter.frequency.value = 260;
    this.rollGain = ctx.createGain();
    this.rollGain.gain.value = 0;
    this.roll.connect(this.rollFilter).connect(this.rollGain).connect(this.sfx);

    // 海浪（左侧）+ 慢速 LFO
    this.surf = this.loop(this.brown);
    const surfF = ctx.createBiquadFilter();
    surfF.type = 'lowpass';
    surfF.frequency.value = 620;
    this.surfGain = ctx.createGain();
    this.surfGain.gain.value = 0.09;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.1;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.055;
    lfo.connect(lfoGain).connect(this.surfGain.gain);
    lfo.start();
    const pan = ctx.createStereoPanner();
    pan.pan.value = -0.6;
    this.surf.connect(surfF).connect(this.surfGain).connect(pan).connect(this.envBus);

    this.enabled = true;
    // 音乐调度
    this.step = 0;
    this.nextNote = ctx.currentTime + 0.5;
    this.timer = setInterval(() => this.schedule(), 40);
    this.nextGull = ctx.currentTime + 8;
    // 用户已经选过自定义音乐（比如切画质重建了引擎）就接着放
    if (this.tracks.length && this.customOn) this.playCustom();
  }

  impulse(sec, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  noiseBuffer() {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  brownBuffer() {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    return buf;
  }

  loop(buf) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.start();
    return s;
  }

  // 一次性声音响完必须自己从音频图上摘下来——Web Audio 不会回收仍然连着总线的节点，
  // 而这里的每个音符、每个音效都是新建节点接到常驻总线上的。不摘的后果是节点只增不减：
  // 音乐每换一次和弦新建二十来个，音效每个再加三四个，实测每分钟累积 250 个左右，
  // 挂机一小时就是上万个，音频线程的图遍历和内存开销一路涨，听感上就是隔一阵「啪」一下。
  // 挂在源节点的 onended 上：它 stop() 之后才触发，此时断线不会截断声音。
  dispose(src, ...rest) {
    const all = [src, ...rest];
    src.onended = () => {
      for (const n of all) {
        try {
          n.disconnect();
        } catch {
          // 已经断过或节点已销毁，忽略
        }
      }
    };
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }
  setMusicVolume(v) {
    this.musicVolume = v;
    this.applyMusicGains();
  }
  // 海浪 + 风声音量（0~1，0 等价于关闭）
  setEnvVolume(v) {
    this.envVolume = v;
    this.applyEnvGain();
  }
  setEnv(on) {
    this.envOn = on;
    this.applyEnvGain();
  }
  applyEnvGain() {
    if (!this.ctx || !this.envBus) return;
    const v = this.envOn ? this.envVolume : 0;
    // 淡入淡出，避免拖动滑块时爆音
    this.envBus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.12);
  }
  setMusic(on) {
    this.musicOn = on;
    this.applyMusicGains();
    // 关掉音乐时把自定义曲目也停下来，省电也避免偷偷播
    if (!on) this.customEl?.pause();
    else if (this.customOn && this.tracks.length) this.playCustom();
  }
  // 自定义音乐与生成式音乐互斥，谁在放谁占音乐音量
  applyMusicGains() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const v = this.musicOn ? this.musicVolume : 0;
    const custom = this.customOn && this.tracks.length > 0;
    this.musicBus?.gain.setTargetAtTime(custom ? 0 : v, t, 0.25);
    this.customGain?.gain.setTargetAtTime(custom ? v : 0, t, 0.25);
  }
  setCustomOn(on) {
    this.customOn = !!on && this.tracks.length > 0;
    this.applyMusicGains();
    if (this.customOn && this.musicOn) this.playCustom();
    else this.customEl?.pause();
  }
  mute(m) {
    if (!this.ctx) return;
    if (m) this.ctx.suspend();
    else this.ctx.resume();
  }

  // ------- 自定义背景音乐：用户上传的本地音频 -------
  // 元素接进 WebAudio 总线，主音量 / 音乐音量 / 静音都能一起生效
  loadCustomMusic(files) {
    const list = [...files].filter(
      (f) => (f.type || '').startsWith('audio/') || /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|wma)$/i.test(f.name || ''),
    );
    if (!list.length) return false;
    return this.loadCustomTracks(list.map((f) => ({ name: f.name.replace(/\.[^.]+$/, ''), blob: f })));
  }
  // tracks: [{ name, blob }]。blob 既可以是刚选中的 File，也可以是从 IndexedDB 里
  // 取回来的 Blob（插件要跨标签页记住用户的曲子），两者走同一条装载路径。
  loadCustomTracks(tracks) {
    if (!this.ctx) return false;
    const list = (tracks || []).filter((t) => t && t.blob);
    if (!list.length) return false;
    this.clearCustomMusic();
    this.tracks = list.map((t) => ({ name: String(t.name || '未命名'), url: URL.createObjectURL(t.blob) }));
    this.trackIdx = 0;
    const el = new Audio();
    el.preload = 'auto';
    el.volume = 1;
    el.addEventListener('ended', () => this.nextTrack());
    el.addEventListener('error', () => this.nextTrack());
    this.customEl = el;
    if (!this.customGain) {
      // 用户自己的歌不加低通也不加混响，直接进主音量
      this.customGain = this.ctx.createGain();
      this.customGain.gain.value = 0;
      this.customGain.connect(this.master);
    }
    this.customSrc = this.ctx.createMediaElementSource(el);
    this.customSrc.connect(this.customGain);
    this.customOn = true;
    this.trackName = this.tracks[0].name;
    this.applyMusicGains();
    if (this.musicOn) this.playCustom();
    return true;
  }
  playCustom() {
    if (!this.customEl || !this.tracks.length) return;
    const track = this.tracks[this.trackIdx % this.tracks.length];
    this.trackName = track.name;
    if (this.customEl.src !== track.url) this.customEl.src = track.url;
    const p = this.customEl.play();
    // 自动播放被浏览器拦下（没有用户手势）时先静音，等下一次手势再补上
    if (p?.catch) p.catch(() => this.applyMusicGains());
  }
  nextTrack() {
    if (!this.tracks.length) return;
    this.trackIdx = (this.trackIdx + 1) % this.tracks.length;
    if (this.customOn && this.musicOn) this.playCustom();
  }
  clearCustomMusic() {
    if (this.customEl) {
      this.customEl.pause();
      this.customEl.removeAttribute('src');
      this.customEl.load?.();
      this.customEl = null;
    }
    this.customSrc?.disconnect?.();
    this.customSrc = null;
    for (const t of this.tracks) URL.revokeObjectURL(t.url);
    this.tracks = [];
    this.trackIdx = 0;
    this.customOn = false;
    this.trackName = '';
    this.applyMusicGains();
  }

  update(p) {
    Object.assign(this.params, p);
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const v = p.speed;
    this.windGain.gain.setTargetAtTime(Math.min(0.3, v * v * 0.0016), t, 0.25);
    this.windFilter.frequency.setTargetAtTime(220 + v * 55, t, 0.25);
    this.rollGain.gain.setTargetAtTime(p.airborne ? 0 : Math.min(0.22, v * 0.02), t, 0.05);
    this.rollFilter.frequency.setTargetAtTime(150 + v * 18, t, 0.25);
    // 背景层只用风声、海浪声和胎噪；链条 / 飞轮棘轮那类机械拟音一律不放
    // 海鸥只是偶尔远远叫一声，别太吵
    if (t > this.nextGull) {
      this.gull(t);
      this.nextGull = t + 15 + Math.random() * 25;
    }
  }

  click(t, vol) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 3500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
    s.connect(f).connect(g).connect(this.sfx);
    this.dispose(s, f, g);
    s.start(t, Math.random(), 0.03);
  }

  tone({ freq, type = 'sine', t, dur, vol, attack = 0.005, dest, detune = 0, glide }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur);
    o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest || this.sfx);
    this.dispose(o, g);
    o.start(t);
    o.stop(t + dur + 0.05);
    return g;
  }

  bell() {
    if (!this.enabled) return;
    const t0 = this.ctx.currentTime;
    for (const off of [0, 0.16]) {
      const t = t0 + off;
      const base = 2350;
      [1, 2.63, 4.17, 5.43].forEach((r, i) => {
        const g = this.tone({ freq: base * r, t, dur: 1.4 - i * 0.25, vol: 0.18 / (i + 1), detune: i * 4 });
        g.connect(this.reverb);
      });
      this.tone({ freq: base * 1.004, t, dur: 1.2, vol: 0.08 });
    }
  }

  honk() {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(190, t);
    o.frequency.linearRampToValueAtTime(240, t + 0.08);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.45);
    const vib = ctx.createOscillator();
    vib.frequency.value = 28;
    const vg = ctx.createGain();
    vg.gain.value = 18;
    vib.connect(vg).connect(o.frequency);
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = 720;
    f1.Q.value = 4;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = 1250;
    f2.Q.value = 5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.7, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(f1).connect(g);
    o.connect(f2).connect(g);
    g.connect(this.sfx);
    g.connect(this.reverb);
    this.dispose(o, vib, vg, f1, f2, g);
    o.start(t);
    vib.start(t);
    o.stop(t + 0.55);
    vib.stop(t + 0.55);
  }

  // 鱼跃水花。目前没有调用点：它在背景里是唯一的高频宽带噪声，每隔几秒响一次很吵，
  // 已经按要求去掉（画面上的水花粒子还留着）。要恢复就在 main.js 的 launchJumper / 落水处各加一行 audio.splash()。
  splash() {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(2400, t);
    f.frequency.exponentialRampToValueAtTime(400, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    const pan = ctx.createStereoPanner();
    pan.pan.value = -0.5;
    s.connect(f).connect(g).connect(pan).connect(this.sfx);
    this.dispose(s, f, g, pan);
    s.start(t, Math.random(), 0.6);
  }

  thump() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    this.tone({ freq: 110, glide: 45, t, dur: 0.25, vol: 0.5 });
    this.click(t, 0.2);
  }

  whoosh() {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.5;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(2200, t + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    s.connect(f).connect(g).connect(this.sfx);
    this.dispose(s, f, g);
    s.start(t, Math.random(), 0.6);
  }

  gull(t) {
    const ctx = this.ctx;
    const n = 1 + Math.floor(Math.random() * 2);
    const pan = ctx.createStereoPanner();
    pan.pan.value = -0.3 - Math.random() * 0.6;
    const out = ctx.createGain();
    out.gain.value = 0.025;
    out.connect(pan).connect(this.sfx);
    out.connect(this.reverb);
    const chain = [out, pan];
    for (let i = 0; i < n; i++) {
      const s = t + i * 0.3;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(1400, s);
      o.frequency.exponentialRampToValueAtTime(2100, s + 0.07);
      o.frequency.exponentialRampToValueAtTime(1050, s + 0.24);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 2000;
      f.Q.value = 2.4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(1, s + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.26);
      o.connect(f).connect(g).connect(out);
      // 叫声可能是两声（i = 0,1），等最后一声放完再整串摘下来
      chain.push(o, f, g);
      if (i === n - 1) this.dispose(o, ...chain);
      o.start(s);
      o.stop(s + 0.32);
    }
  }

  // ------- 生成式氛围乐：慢速铺底 + 稀疏点缀，全程没有鼓点 -------
  // 一拍 1.4 秒、八拍换一次和弦，音符淡入淡出都在 3 秒上下，听感是一片流动的和声而不是旋律
  schedule() {
    if (!this.enabled || !this.musicOn || this.customOn) return;
    const ctx = this.ctx;
    const stepDur = 1.4;
    // 音乐关闭/后台期间不补发积压的音符
    if (this.nextNote < ctx.currentTime) this.nextNote = ctx.currentTime + 0.2;
    while (this.nextNote < ctx.currentTime + 0.7) {
      this.playStep(this.step, this.nextNote, stepDur);
      this.nextNote += stepDur;
      this.step = (this.step + 1) % 256;
    }
  }

  playStep(step, t, dur) {
    // C 大调 / A 小调色彩：Am9 - Fmaj9 - Cmaj9 - G6/9
    const chords = [
      [45, 64, 67, 71, 72],
      [41, 60, 64, 67, 72],
      [43, 62, 64, 67, 71],
      [43, 59, 62, 67, 69],
    ];
    const bus = this.musicBus;
    const night = this.params.night;
    const bar = Math.floor(step / 8) % chords.length;
    const s = step % 8;
    const ch = chords[bar];
    const pad = dur * 9;
    if (s === 0) {
      // 铺底和弦：每个音都错开一点点进入，像海面上的雾
      ch.forEach((n, i) => {
        this.tone({
          freq: midi(n),
          type: i % 2 ? 'triangle' : 'sine',
          t: t + i * 0.25,
          dur: pad,
          vol: 0.028,
          attack: 3.4,
          dest: bus,
          detune: i % 2 ? 7 : -7,
        });
        this.tone({ freq: midi(n) * 2.003, type: 'sine', t: t + 0.6, dur: pad * 0.7, vol: 0.007, attack: 4.2, dest: bus });
      });
      this.tone({ freq: midi(ch[0] - 12), type: 'sine', t, dur: pad * 0.8, vol: 0.09, attack: 2.6, dest: bus });
    }
    // 稀疏的风铃：很轻、带混响，夜里更少
    if (s % (night > 0.6 ? 4 : 3) === 0) {
      const n = ch[(step * 5) % ch.length] + 24;
      this.tone({ freq: midi(n), type: 'sine', t: t + 0.05, dur: 3.8, vol: 0.032, attack: 0.35, dest: bus }).connect(this.reverb);
      if (Math.random() < 0.3) {
        this.tone({ freq: midi(n + 7), type: 'sine', t: t + 0.4, dur: 3.2, vol: 0.02, attack: 0.4, dest: bus }).connect(this.reverb);
      }
    }
  }
}
