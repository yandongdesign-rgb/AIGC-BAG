import { clamp } from '../core/math.js';
import { classify } from './classifier.js';
import { extractFeatures, isActualRight } from './features.js';
import { LandmarkFilter } from './oneEuro.js';
import { Stabilizer } from './stabilizer.js';

/**
 * 把每帧检测结果 → 稳定的手势状态（按手分槽位），并给出双手距离与状态切换事件。
 * 纯逻辑模块（无 DOM / three 依赖），可在 Node 中单元测试。
 */
export class GestureInterpreter {
  constructor(cfg) {
    this.cfg = cfg;
    this.slots = new Map();
  }

  _slot(key) {
    let s = this.slots.get(key);
    if (!s) {
      s = {
        key,
        filter: new LandmarkFilter(this.cfg.filter),
        stab: new Stabilizer(this.cfg.stabilizer),
        mem: {},
        lastT: 0,
        lastSeen: 0,
        prevCenterY: null,
        rise: 0,
        hand: null,
      };
      this.slots.set(key, s);
    }
    return s;
  }

  /**
   * @param {{landmarks:{x,y,z}[], handedness:string, score:number}[]} hands
   * @param {number} now 毫秒
   * @param {number} aspect 视频宽/高
   */
  update(hands, now, aspect) {
    const cfg = this.cfg;
    const events = [];
    const seen = new Set();
    const counts = {};

    for (const h of hands) {
      if (h.score < cfg.minHandConfidence) continue;
      counts[h.handedness] = (counts[h.handedness] || 0) + 1;
      const key = `${h.handedness}${counts[h.handedness] > 1 ? counts[h.handedness] : ''}`;
      seen.add(key);
      const s = this._slot(key);
      const dt = s.lastT ? clamp((now - s.lastT) / 1000, 1 / 240, 0.25) : 1 / 30;
      s.lastT = now;
      s.lastSeen = now;

      const lm = s.filter.apply(h.landmarks, dt);
      const f = extractFeatures(lm, { aspect, label: h.handedness, cfg });
      if (s.prevCenterY !== null) {
        const v = -(f.center.y - s.prevCenterY) / dt / Math.max(f.palm, 1e-3);
        s.rise += (v - s.rise) * clamp(dt * 12, 0, 1);
      }
      s.prevCenterY = f.center.y;

      const raw = classify(f, lm, { prev: s.stab.state, mem: s.mem, now, rise: s.rise, cfg });
      const r = s.stab.update(raw, now);
      if (r.changed) events.push({ type: 'state', key, state: r.state, prev: r.prev });
      s.hand = {
        key,
        side: isActualRight(h.handedness, false) ? 'right' : 'left',
        score: h.score,
        landmarks: lm,
        features: f,
        raw,
        state: r.state,
        changed: r.changed,
        rise: s.rise,
        lost: false,
      };
    }

    for (const [key, s] of this.slots) {
      if (seen.has(key)) continue;
      if (now - s.lastSeen > cfg.stabilizer.lostGraceMs) {
        if (s.stab.state !== 'none') events.push({ type: 'state', key, state: 'none', prev: s.stab.state });
        this.slots.delete(key);
      } else if (s.hand) {
        s.hand.lost = true;
        s.hand.changed = false;
      }
    }

    const active = [...this.slots.values()].map((s) => s.hand).filter(Boolean);
    let dual = { active: false, distance: 0, t: 0, mid: null };
    const present = active.filter((h) => !h.lost);
    if (present.length >= 2) {
      const [a, b] = present;
      const dx = a.features.center.x - b.features.center.x;
      const dy = (a.features.center.y - b.features.center.y) / aspect;
      const d = Math.hypot(dx, dy);
      dual = {
        active: true,
        distance: d,
        t: clamp((d - cfg.dual.minDistance) / (cfg.dual.maxDistance - cfg.dual.minDistance), 0, 1),
        mid: {
          x: (a.features.center.x + b.features.center.x) / 2,
          y: (a.features.center.y + b.features.center.y) / 2,
        },
      };
    }
    return { hands: active, dual, events };
  }
}
