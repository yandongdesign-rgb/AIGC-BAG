const fmt = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : '—');

/** 左上角性能/状态面板 + 底部手势标签 */
export class Hud {
  constructor(el, tagEl, mapping) {
    this.el = el;
    this.tagEl = tagEl;
    this.map = mapping;
    this.toastEl = document.querySelector('#toast');
    this.m = null;
  }

  label(state) {
    return this.map.gestures[state]?.label || state;
  }

  lines() {
    const m = this.m;
    if (!m) return [];
    const hands = m.hands.map((h) => `${h.side === 'right' ? '右' : '左'}手:${this.label(h.state)}`).join('  ') || '无手';
    return [
      `FPS ${fmt(m.fps)}  ·  延迟 ${fmt(m.latencyMs, 1)} ms（${m.latencyKind}）`,
      `粒子 ${m.alive}/${m.limit}  ·  画质 ${m.quality}  ·  ${hands}${m.dual !== null ? `  ·  双手 ${fmt(m.dual * 100)}%` : ''}`,
    ];
  }

  update(m, frame, sim) {
    this.m = m;
    const fpsCls = m.fps >= 30 ? '' : m.fps >= 24 ? 'warn' : 'bad';
    const pk = Math.max(0, Math.min(1, (m.peakDb + 48) / 48));
    this.el.innerHTML = `
      <div class="big ${fpsCls}">${fmt(m.fps)} FPS</div>
      <div>帧耗时&nbsp;&nbsp;${fmt(m.frameMs, 1)} ms</div>
      <div>延迟&nbsp;&nbsp;&nbsp;&nbsp;${fmt(m.latencyMs, 1)} ms <small>(${m.latencyKind})</small></div>
      ${m.source === 'camera' ? `<div>推理&nbsp;&nbsp;&nbsp;&nbsp;${fmt(m.inferMs, 1)} ms</div>` : ''}
      <div>粒子&nbsp;&nbsp;&nbsp;&nbsp;${m.alive} / ${m.limit}</div>
      <div>画质&nbsp;&nbsp;&nbsp;&nbsp;${m.quality}${m.bloom ? ' · 辉光' : ''}</div>
      <div>输入&nbsp;&nbsp;&nbsp;&nbsp;${{ camera: '摄像头', demo: '演示模式', idle: '待机' }[m.source]}${sim ? ` · ${sim.mode === 'auto' ? '巡演' : '手动'}` : ''}</div>
      <div>音频&nbsp;&nbsp;&nbsp;&nbsp;${m.audio} · 峰值 ${fmt(m.peakDb, 1)} dBFS · 削波 ${m.clips}</div>
      <div class="meter"><i style="width:${(pk * 100).toFixed(0)}%"></i></div>`;
    const tags = frame.hands.map(
      (h) => `<div class="tag"><b>${h.side === 'right' ? '右手' : '左手'}</b>${this.label(h.state)} <small>${(h.score * 100).toFixed(0)}%</small></div>`,
    );
    if (frame.dual.active) tags.push(`<div class="tag"><b>双手</b>${this.map.dual.label} ${(frame.dual.t * 100).toFixed(0)}%</div>`);
    if (!tags.length) tags.push(`<div class="tag">${this.label('none')} · 待机粒子流</div>`);
    this.tagEl.innerHTML = tags.join('');
  }

  toast(msg, ms = 2200) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this._t);
    this._t = setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }
}
