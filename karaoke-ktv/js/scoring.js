/**
 * ============================================================
 *  打分模块（ScoreEngine，简易版）
 *  根据麦克风人声与歌词时间轴的"节拍匹配"计分：
 *   - 节奏：歌词演唱区间内是否有人声（覆盖率）
 *   - 稳定：人声中可检测到稳定音高的比例
 *   - 间奏期间乱唱会少量扣分
 *  每句结束给出 PERFECT / GREAT / GOOD / OK / MISS，整曲结束给出分数 + 星级
 * ============================================================
 */
(function (global) {
  'use strict';

  class ScoreEngine extends EventTarget {
    constructor() { super(); this.reset([]); }

    reset(lines) {
      this.lines = lines || [];
      this.stats = this.lines.map(() => ({ frames: 0, voiced: 0, pitched: 0, done: false, score: 0 }));
      this.gapFrames = 0; this.gapVoiced = 0;
      this.noise = 0.004;
      this.active = false;      // 本曲是否开启过麦克风
      this.lastIdx = -1;
      this.lineScores = [];
      this.live = 0;
    }

    /** 每帧调用：t 播放时间，rms 麦克风电平，pitch 检测到的基频 */
    sample(t, rms, pitch, micOn) {
      if (!micOn || !this.lines.length) { this._flush(t); return; }
      this.active = true;
      // 自适应底噪
      this.noise = rms < this.noise ? this.noise * 0.9 + rms * 0.1 : this.noise * 0.9995 + rms * 0.0005;
      const voiced = rms > Math.max(0.012, this.noise * 2.6);
      let idx = -1;
      for (let i = Math.max(0, this.lastIdx - 1); i < this.lines.length; i++) {
        const l = this.lines[i];
        if (t >= l.time - 0.15 && t <= l.end + 0.25) { idx = i; break; }
        if (l.time > t) break;
      }
      if (idx >= 0) {
        const st = this.stats[idx];
        st.frames++; if (voiced) { st.voiced++; if (pitch > 70 && pitch < 1100) st.pitched++; }
        this.lastIdx = Math.max(this.lastIdx, idx);
      } else { this.gapFrames++; if (voiced) this.gapVoiced++; }
      this._flush(t);
    }

    /** 已结束的句子出分 */
    _flush(t) {
      for (let i = 0; i < this.lines.length; i++) {
        const st = this.stats[i], l = this.lines[i];
        if (st.done || t < l.end + 0.3) continue;
        st.done = true;
        if (!this.active) continue;
        const cover = st.frames ? st.voiced / st.frames : 0;
        const stab = st.voiced ? st.pitched / st.voiced : 0;
        const s = Math.round(Math.min(1, cover / 0.62) * 72 + Math.min(1, stab / 0.6) * 28);
        st.score = s;
        this.lineScores.push(s);
        const rating = s >= 90 ? 'PERFECT' : s >= 76 ? 'GREAT' : s >= 58 ? 'GOOD' : s >= 30 ? 'OK' : 'MISS';
        this.live = this.current();
        this.dispatchEvent(new CustomEvent('line', { detail: { index: i, score: s, rating } }));
      }
    }

    current() {
      const done = this.stats.filter((s) => s.done);
      if (!done.length) return 0;
      const avg = done.reduce((a, s) => a + s.score, 0) / done.length;
      return Math.round(avg);
    }

    /** 整曲结算 */
    final() {
      if (!this.active || !this.stats.length) return null;
      const avg = this.stats.reduce((a, s) => a + s.score, 0) / this.stats.length;
      const gapPenalty = this.gapFrames ? Math.min(8, (this.gapVoiced / this.gapFrames) * 12) : 0;
      let score = avg > 1 ? Math.round(Math.max(0, Math.min(100, avg * 0.85 + 15 - gapPenalty))) : 0;
      const stars = score >= 92 ? 5 : score >= 82 ? 4 : score >= 70 ? 3 : score >= 55 ? 2 : score > 0 ? 1 : 0;
      const grade = score >= 95 ? 'SSS' : score >= 90 ? 'SS' : score >= 85 ? 'S' : score >= 75 ? 'A' : score >= 65 ? 'B' : 'C';
      const counts = { PERFECT: 0, GREAT: 0, GOOD: 0, OK: 0, MISS: 0 };
      this.stats.forEach((s) => {
        const r = s.score >= 90 ? 'PERFECT' : s.score >= 76 ? 'GREAT' : s.score >= 58 ? 'GOOD' : s.score >= 30 ? 'OK' : 'MISS';
        counts[r]++;
      });
      return { score, stars, grade, counts };
    }
  }
  global.KTVScore = { ScoreEngine };
})(window);
