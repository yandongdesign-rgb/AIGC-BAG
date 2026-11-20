/**
 * 配置加载器：优先读取 config/*.json，失败时使用内置默认配置（支持直接双击 index.html 预览 Demo）。
 * 暴露 window.GPConfig / window.reloadConfig()
 */
(function (global) {
  'use strict';

  const DEFAULTS = {
    mapping: {
      statePriority: ['DUAL', 'PINCH', 'FIST', 'POINT', 'LIFT', 'OPEN', 'IDLE'],
      gestures: [
        { id: 'OPEN', label: '手掌张开', accent: '#48e0c0', effects: [{ mode: 'TRAIL', weight: 1 }], sound: { layers: ['flow'], trigger: 'sweep' } },
        { id: 'FIST', label: '握拳', accent: '#ff7a45', effects: [{ mode: 'BURST', weight: 1 }], sound: { layers: [], trigger: 'impact' } },
        { id: 'POINT', label: '食指指向', accent: '#8fd6ff', effects: [{ mode: 'LIGHTNING', weight: 1 }], sound: { layers: ['electric'], trigger: 'zap' } },
        { id: 'PINCH', label: '捏合', accent: '#b18cff', effects: [{ mode: 'VORTEX', weight: 1 }], sound: { layers: ['rotation'], trigger: 'suck' } },
        { id: 'LIFT', label: '摊平上抬', accent: '#ffe08a', effects: [{ mode: 'SCATTER', weight: 1 }, { mode: 'TRAIL', weight: 0.25 }], sound: { layers: ['pad'], trigger: 'chime' } },
        { id: 'DUAL', label: '双手', accent: '#ff74b8', effects: [{ mode: 'VORTEX', weight: 0.7 }, { mode: 'BURST', weight: 0.35 }], sound: { layers: ['dual'], trigger: 'pitchSlide' } },
        { id: 'IDLE', label: '待机', accent: '#6f8ba8', effects: [{ mode: 'IDLE', weight: 1 }], sound: { layers: ['ambience'], trigger: 'silence' } }
      ],
      audioLayers: {
        ambience: { gain: 0.05, fade: 0.6 }, flow: { gain: 0.16, fade: 0.35 },
        electric: { gain: 0.05, fade: 0.12 }, rotation: { gain: 0.14, fade: 0.3 },
        pad: { gain: 0.13, fade: 0.5 }, dual: { gain: 0.12, fade: 0.3 }
      },
      soundTriggers: {
        sweep: { gain: 0.18, cooldown: 0.9 }, impact: { gain: 0.55, cooldown: 0.25 },
        zap: { gain: 0.32, cooldown: 0.09 }, suck: { gain: 0.3, cooldown: 0.7 },
        chime: { gain: 0.22, cooldown: 0.45 }, pitchSlide: { gain: 0.12, cooldown: 1.2 },
        silence: { gain: 0, cooldown: 0.1 }
      }
    },
    recognition: {
      minConfidence: 0.55, maxHands: 2, modelComplexity: 1,
      fingerExtendedAngle: 150, thumbExtendedAngle: 148, thumbSpreadRatio: 1.02,
      extendedCountForOpen: 4, pinchRatio: 0.32, pinchReleaseRatio: 0.42,
      fistMaxExtended: 1, liftVelocity: 0.42, liftHoldFrames: 3, liftCooldown: 0.5,
      velocityWindow: 0.22, smoothing: 0.45, stateHoldMs: 110,
      resizeWidth: 640, resizeHeight: 480, handednessMirror: true,
      classifier: 'rule-based-v1', customClassifierUrl: ''
    },
    particles: {
      global: {
        capacity: 6000, startCount: 3200, minCount: 900, maxCount: 6000,
        targetFps: 45, minFps: 30, fadeAlpha: 0.16, transitionTau: 0.18,
        gravity: 26, maxPixelRatio: 2, background: '#050912'
      },
      modes: {
        IDLE: { emitRate: 26, life: [3, 6], speed: [8, 26], size: [2, 5], drag: 0.995, gravity: -3, hue: [195, 225], saturation: 0.45, lightness: 0.55, alpha: 0.35, spawn: 'screenBottom' },
        TRAIL: { emitRate: 260, life: [0.7, 1.6], speed: [12, 90], size: [4, 12], drag: 0.955, gravity: 4, hue: [160, 310], hueDrift: 42, saturation: 0.9, lightness: 0.62, alpha: 0.9, spawn: 'fingertips', ribbonSubSteps: 2 },
        BURST: { emitRate: 180, life: [0.45, 1.25], speed: [180, 620], size: [3, 11], drag: 0.955, gravity: 90, hue: [12, 52], saturation: 1, lightness: 0.65, alpha: 1, spawn: 'fistCenter', burstCount: 620, sparkRatio: 0.28 },
        LIGHTNING: { emitRate: 260, life: [0.12, 0.42], speed: [30, 130], size: [2.2, 6.5], drag: 0.9, gravity: 0, hue: [185, 265], saturation: 0.85, lightness: 0.78, alpha: 1, spawn: 'boltPath', boltInterval: 0.11, boltSegments: 15, boltJitter: 26, branchChance: 0.55, boltLength: 0.34 },
        VORTEX: { emitRate: 420, life: [0.9, 2.1], speed: [160, 380], size: [3, 10], drag: 0.985, gravity: 0, hue: [255, 320], saturation: 0.95, lightness: 0.68, alpha: 0.95, spawn: 'pinchRing', innerRadius: 18, outerRadius: 130, tangential: 1, inward: 0.32, swirlAccel: 140 },
        SCATTER: { emitRate: 380, life: [2, 4.5], speed: [40, 190], size: [3.5, 12], drag: 0.99, gravity: -14, hue: [30, 330], hueDrift: 55, saturation: 0.8, lightness: 0.7, alpha: 0.85, spawn: 'palmBurst', upwardBias: 0.85, wind: 12 }
      },
      themes: {
        midnight: { background: '#050912', hueShift: 0, name: '午夜深蓝' },
        void: { background: '#020207', hueShift: 35, name: '虚空黑' },
        aurora: { background: '#04121a', hueShift: -30, name: '极光青' }
      }
    }
  };

  function deepMerge(base, extra) {
    if (!extra || typeof extra !== 'object') return base;
    for (const k of Object.keys(extra)) {
      if (extra[k] && typeof extra[k] === 'object' && !Array.isArray(extra[k]) &&
          base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
        deepMerge(base[k], extra[k]);
      } else {
        base[k] = extra[k];
      }
    }
    return base;
  }

  const state = {
    mapping: JSON.parse(JSON.stringify(DEFAULTS.mapping)),
    recognition: JSON.parse(JSON.stringify(DEFAULTS.recognition)),
    particles: JSON.parse(JSON.stringify(DEFAULTS.particles))
  };

  async function loadOne(name) {
    try {
      const res = await fetch('config/' + name + '.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      deepMerge(state[name], data);
      return true;
    } catch (e) {
      console.warn('[config] 使用内置默认值:', name, e.message);
      return false;
    }
  }

  async function loadConfig() {
    await Promise.all([loadOne('mapping'), loadOne('recognition'), loadOne('particles')]);
    return state;
  }

  global.GPConfig = state;
  global.loadConfig = loadConfig;
  global.reloadConfig = async function () {
    const s = await loadConfig();
    if (global.GPApp && typeof global.GPApp.applyConfig === 'function') global.GPApp.applyConfig();
    return s;
  };
})(window);
