// 所有可调参数集中在这里，修改后刷新页面即可生效
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.SG = root.SG || {};
  root.SG.CONFIG = {
    camera: { width: 1280, height: 720, fps: 30 },
    tracking: {
      numHands: 2,
      minDetection: 0.6,
      minPresence: 0.5,
      minTracking: 0.5,
      lostGraceMs: 260,     // 手短暂丢失时保留的时间
      smoothing: 22,        // 关键点平滑强度（越大越跟手）
    },
    gesture: {
      stableFrames: 3,      // 连续多少帧一致才确认手势
      fastFrames: 2,        // 握拳 / 张开 这两种使用更快的确认
      pinchOn: 0.32,        // 捏合阈值（拇指尖-食指尖距离 / 掌长）
      pinchOff: 0.46,
    },
    particles: { max: 42000, dust: 1400 },
    spells: {
      fuseDistance: 1.45,   // 赫 与 苍 靠近多少个掌长时融合为 茈
      burstMinCharge: 0.12,
      blackFlashSpeed: 1.55, // 握拳移动速度（屏幕高度/秒）超过此值触发 黑闪
      blackFlashCooldown: 0.9,
      domainHold: 1.0,      // 双手张开保持多少秒展开领域
      domainDuration: 10,
    },
    audio: { master: 0.9, music: 0.5, sfx: 1.0 },
  };
})();
