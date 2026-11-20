/**
 * ============================================================
 *  手势交互粒子引擎 · 总配置文件
 *  非技术人员只需改这里的数值，保存后刷新浏览器即可生效。
 * ============================================================
 */
export const CONFIG = {
  // ---------------- 摄像头 ----------------
  camera: {
    width: 640,
    height: 480,
    mirror: true,          // 镜像显示（像照镜子一样）
    showPreview: true,     // 启动时是否显示右下角摄像头小窗（按 C 键切换）
  },

  // ---------------- 手部跟踪（MediaPipe Hands，21 关键点） ----------------
  tracking: {
    numHands: 2,
    minDetectionConfidence: 0.6,   // 检测置信度阈值
    minPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    lostTimeout: 0.25,             // 手丢失多久(秒)后判定为“无手”
    delegate: 'GPU',               // 'GPU' 或 'CPU'
    // 只用摄像头中间区域映射到全屏，手不用伸到画面边缘（0 = 不扩展）
    inputMargin: 0.08,
    // 依赖地址：默认走 CDN；运行 tools/download_vendor.py 后可改为本地 './vendor/...'
    modulePath: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs',
    wasmPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm',
    modelPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
    localVendor: {   // 本地离线版本（存在时优先使用）
      modulePath: './vendor/tasks-vision/vision_bundle.mjs',
      wasmPath: './vendor/tasks-vision/wasm',
      modelPath: './vendor/hand_landmarker.task',
    },
    // One-Euro 滤波：minCutoff 越小越平滑（越拖），beta 越大越跟手
    smoothing: { minCutoff: 1.4, beta: 0.015, dCutoff: 1.0 },
  },

  // ---------------- 手势判定阈值（规则分类） ----------------
  gestures: {
    fingerExtendRatio: 1.12,   // 指尖到手腕距离 > 指中关节到手腕距离 × 该值 → 伸直
    fingerCurlRatio: 1.0,      // 小于 × 该值 → 弯曲
    straightAngle: 140,        // 指中关节夹角 > 该角度(°) 视为伸直
    thumbExtendRatio: 0.62,    // 拇指尖到中指根距离 / 手掌尺寸 > 该值 → 拇指伸开
    pinchRatio: 0.26,          // 拇指尖-食指尖距离 / 手掌尺寸 < 该值 → 捏合
    pinchReleaseRatio: 0.36,   // 捏合后需大于该值才松开（迟滞，防抖）
    palmUp: {
      mode: 'orientation',     // 'orientation' 掌心朝向 | 'lift' 张开手向上移动 | 'either' 任一
      normalThreshold: 0.45,   // 掌心法线竖直分量阈值
      invertNormal: false,     // 若“掌心朝上”判定反了，改成 true
      liftSpeed: 1.6,          // 'lift' 模式：上移速度（手掌尺寸/秒）
    },
    stabilizer: {              // 时间防抖：最近 windowFrames 帧里至少 minVotes 帧一致才切换
      windowFrames: 6,
      minVotes: 4,
    },
  },

  // ---------------- 手势 ↔ 粒子特效 ↔ 音效 映射表（核心） ----------------
  // modes: 粒子模式 id 列表（可写多个实现叠加）；sounds: 音效层 id 列表
  mapping: {
    OPEN_PALM: { label: '手掌张开', modes: ['trail'],     sounds: ['trail'] },
    FIST:      { label: '握拳',     modes: ['burst'],     sounds: ['burst'] },
    POINT:     { label: '食指指向', modes: ['lightning'], sounds: ['lightning'] },
    PINCH:     { label: '捏合',     modes: ['vortex'],    sounds: ['vortex'] },
    PALM_UP:   { label: '掌心上抬', modes: ['scatter'],   sounds: ['scatter'] },
    UNKNOWN:   { label: '未识别',   modes: ['cursor'],    sounds: [] },
    // 示例插件手势（src/plugins/example-ripple.js）
    VICTORY:   { label: '剪刀手(插件)', modes: ['ripple'], sounds: ['ripple'] },
  },
  dual: {           // 双手同时出现时额外叠加
    label: '双手',
    modes: ['dualLink'],
    sounds: ['dual'],
    minDist: 0.12,  // 双手距离(占屏宽比例) 映射范围
    maxDist: 0.75,
    minScale: 0.55, // 漩涡/爆点半径缩放范围
    maxScale: 1.9,
  },
  idle: { label: '待机', modes: ['ambient'], sounds: ['ambient'] },

  // ---------------- 状态过渡 ----------------
  transition: {
    fadeIn: 0.35,   // 特效淡入时间(秒)  需求范围 0.3–0.6
    fadeOut: 0.5,   // 特效淡出时间(秒)
  },

  // ---------------- 粒子参数表 ----------------
  particles: {
    maxParticles: 60000,   // 粒子池上限（会被性能档位进一步限制）
    ambient:  { rate: 70, life: [6, 11], size: [1.2, 3.2], alpha: [0.15, 0.45], speed: 22, fallGravity: 45 },
    trail:    { spacing: 2.6, basePerFrame: 2, life: [0.45, 1.1], size: [5, 9], drag: 3.2, alpha: 0.85, fingers: [0, 1, 2, 3, 4], headGlow: 22 },
    burst:    { debris: 1500, ring: 280, sparks: 260, speed: [180, 1500], ringSpeed: 950, gravity: 520, life: [0.6, 1.7], cooldown: 0.3, shake: 14, flash: 0.28, embersPerSec: 45 },
    lightning:{ reach: 0.55, interval: [0.035, 0.075], roughness: 0.22, depth: 6, branchChance: 0.38, coreSpacing: 2.6, coreSize: 3.2, glowSize: 15 },
    vortex:   { radius: 1.3, rate: 1100, omega: 3.2, spinUp: 0.7, influence: 3.2, inflow: 55, life: [1.4, 3.0] },
    scatter:  { rate: 950, life: [2.5, 5.2], speed: [40, 230], upward: [60, 170], gravity: -18, drag: 0.55, size: [2, 7] },
    dualLink: { rate: 260, life: [0.35, 0.8] },
    cursor:   { rate: 30 },
  },

  // ---------------- 渲染 ----------------
  render: {
    trailPersistence: 0.80,  // 残影保留(0~0.95)，越大光带越长
    bloom: 1.05,             // 辉光强度
    exposure: 1.25,          // 曝光（色调映射）
    maxDPR: 2,
    theme: 'neon',           // 默认配色主题（按 T 切换）
  },

  // ---------------- 性能（掉帧自动降级） ----------------
  performance: {
    autoDegrade: true,
    targetFps: 50,           // 低于此帧率持续 downAfter 秒 → 降一档
    downAfter: 1.5,
    upFps: 58,               // 高于此帧率持续 upAfter 秒 → 升一档
    upAfter: 6,
    startLevel: 0,
    levels: [
      { name: '超高', emission: 1.0,  maxParticles: 60000, renderScale: 1.0,  bloom: true },
      { name: '高',   emission: 0.75, maxParticles: 38000, renderScale: 0.85, bloom: true },
      { name: '中',   emission: 0.5,  maxParticles: 22000, renderScale: 0.7,  bloom: true },
      { name: '低',   emission: 0.3,  maxParticles: 12000, renderScale: 0.55, bloom: false },
    ],
  },

  // ---------------- 音效 ----------------
  audio: {
    masterVolume: 0.8,
    reverbSeconds: 3.2,
    // 每一层可单独开关(也可在 P 面板里实时开关) 与调音量
    layers: {
      ambient:   { enabled: true, volume: 0.6 },
      trail:     { enabled: true, volume: 0.9 },
      burst:     { enabled: true, volume: 1.0 },
      lightning: { enabled: true, volume: 0.8 },
      vortex:    { enabled: true, volume: 0.85 },
      scatter:   { enabled: true, volume: 0.8 },
      dual:      { enabled: true, volume: 0.7 },
      transition:{ enabled: true, volume: 0.6 },
      ripple:    { enabled: true, volume: 0.7 },
    },
  },

  // ---------------- 配色主题 ----------------
  // bg: 背景渐变 [中心, 边缘]；其余为各特效调色板（RGB 0~1）
  themes: {
    neon: {
      name: '霓虹',
      bg: [[0.02, 0.03, 0.10], [0.0, 0.0, 0.02]],
      trail: [[1.0, 0.2, 0.6], [0.2, 0.8, 1.0], [0.5, 0.3, 1.0], [0.1, 1.0, 0.6], [1.0, 0.8, 0.2]],
      burst: [[1, 1, 0.9], [1.0, 0.65, 0.15], [1.0, 0.25, 0.05]],
      lightning: [[0.85, 0.95, 1.0], [0.35, 0.55, 1.0]],
      vortex: [[1, 0.95, 0.8], [1.0, 0.45, 0.15], [0.55, 0.15, 1.0]],
      scatter: [[1.0, 0.55, 0.8], [0.6, 0.9, 1.0], [0.75, 0.6, 1.0], [1.0, 0.95, 0.6], [0.5, 1.0, 0.8]],
      ambient: [[0.25, 0.35, 0.8], [0.4, 0.2, 0.7]],
      link: [[0.4, 1.0, 0.9], [1.0, 0.4, 0.9]],
    },
    aurora: {
      name: '极光',
      bg: [[0.0, 0.05, 0.08], [0.0, 0.01, 0.02]],
      trail: [[0.2, 1.0, 0.6], [0.1, 0.8, 0.9], [0.4, 0.5, 1.0], [0.7, 1.0, 0.5], [0.2, 0.6, 1.0]],
      burst: [[0.9, 1, 1], [0.3, 1.0, 0.7], [0.1, 0.4, 0.9]],
      lightning: [[0.9, 1.0, 0.95], [0.2, 1.0, 0.7]],
      vortex: [[0.9, 1, 1], [0.2, 0.9, 0.7], [0.2, 0.3, 0.9]],
      scatter: [[0.5, 1.0, 0.7], [0.4, 0.7, 1.0], [0.8, 1.0, 0.9], [0.3, 0.9, 0.9]],
      ambient: [[0.1, 0.4, 0.4], [0.1, 0.25, 0.5]],
      link: [[0.5, 1.0, 0.7], [0.3, 0.6, 1.0]],
    },
    inferno: {
      name: '烈焰',
      bg: [[0.08, 0.02, 0.01], [0.01, 0.0, 0.0]],
      trail: [[1.0, 0.5, 0.1], [1.0, 0.2, 0.05], [1.0, 0.8, 0.3], [0.9, 0.3, 0.2], [1.0, 0.65, 0.2]],
      burst: [[1, 1, 0.85], [1.0, 0.55, 0.1], [0.8, 0.12, 0.02]],
      lightning: [[1.0, 0.95, 0.8], [1.0, 0.5, 0.15]],
      vortex: [[1, 0.95, 0.7], [1.0, 0.4, 0.05], [0.6, 0.05, 0.05]],
      scatter: [[1.0, 0.7, 0.3], [1.0, 0.4, 0.2], [1.0, 0.9, 0.5]],
      ambient: [[0.5, 0.15, 0.05], [0.3, 0.05, 0.05]],
      link: [[1.0, 0.7, 0.2], [1.0, 0.3, 0.1]],
    },
    ice: {
      name: '寒冰',
      bg: [[0.02, 0.05, 0.12], [0.0, 0.01, 0.03]],
      trail: [[0.7, 0.9, 1.0], [0.4, 0.7, 1.0], [0.9, 0.95, 1.0], [0.5, 0.8, 1.0], [0.6, 0.6, 1.0]],
      burst: [[1, 1, 1], [0.6, 0.85, 1.0], [0.25, 0.45, 1.0]],
      lightning: [[0.95, 0.98, 1.0], [0.5, 0.75, 1.0]],
      vortex: [[1, 1, 1], [0.5, 0.8, 1.0], [0.3, 0.3, 0.9]],
      scatter: [[0.85, 0.95, 1.0], [0.6, 0.8, 1.0], [0.8, 0.8, 1.0]],
      ambient: [[0.2, 0.35, 0.6], [0.15, 0.2, 0.5]],
      link: [[0.7, 0.95, 1.0], [0.5, 0.6, 1.0]],
    },
  },

  // ---------------- 插件（新手势 / 新粒子模式 / 新音效 可插拔） ----------------
  plugins: [
    './src/plugins/example-ripple.js',
  ],
};
