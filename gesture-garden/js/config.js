/**
 * 全局配置：所有可调参数集中在这里。
 * 项目使用普通 <script>（非 ES Module），以保证双击 index.html 即可在 file:// 下运行。
 * 所有模块挂载在 window.GG 命名空间下。
 */
window.GG = window.GG || {};

GG.config = {
  camera: {
    width: 640,          // 低分辨率输入即可满足关键点识别，且推理更快
    height: 480,
    frameRate: 30,
  },

  mediapipe: {
    cdn: 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/',
    maxNumHands: 1,
    modelComplexity: 0,  // 0 = lite 模型，延迟最低
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.5,
  },

  gesture: {
    stableFrames: 2,     // 连续 N 帧一致才切换手势（防抖，≈ 33~66ms）
    lostFrames: 5,       // 连续 N 帧未检测到手才判定“无手”
    latencyBudgetMs: 200,
  },

  garden: {
    growSpeed: 0.11,     // 张开手掌时，时间轴 T 每秒推进量（≈ 9 秒完全盛开）
    retractSpeed: 0.16,  // 收拢时，时间轴 T 每秒回退量
    foldSpeed: 1.6,      // 花瓣收拢速度（每秒）——决定握拳后的即时反馈
    unfoldSpeed: 2.2,    // 花瓣重新张开速度
    initialT: 0.07,      // 初始状态：一点点嫩芽
    fistMode: 'close',   // 'close' = 握拳收拢；'pause' = 握拳暂停
    maxDpr: 2,
  },

  music: {
    volume: 0.55,
    // 若想使用自己的音乐文件，填写相对路径，如 'assets/music.mp3'；留空则使用内置生成式疗愈音乐
    customUrl: '',
  },

  // 柔和自然的低饱和色板
  palette: {
    fog: '#E9EBE2',
    sky: ['#E5EAE3', '#EEEDE5', '#EFEBE0', '#E3E2D3'],
    hills: ['#D9DFD2', '#CDD6C5', '#BFCBB5'],
    ground: ['#C4CDB5', '#AFBC9F'],
    stem: ['#7F9B7B', '#8CA585', '#738F70', '#93A98A'],
    leaf: ['#9DB596', '#8AA684', '#A9BE9F', '#7E9A79', '#B4C4A6'],
    petals: {
      rose:     ['#DDAEA6', '#C99289'],
      blush:    ['#EBCFC5', '#D7B0A4'],
      lavender: ['#BBAFCC', '#A496B8'],
      cream:    ['#F2E8D2', '#DCCDAA'],
      peach:    ['#E9BFA2', '#D4A283'],
      mist:     ['#B5C6CF', '#98AEBA'],
      mauve:    ['#C2A9C0', '#A890A6'],
    },
    center: ['#D6B66E', '#C49E5D', '#B8925F'],
    pollen: '#F7EBCB',
  },
};
