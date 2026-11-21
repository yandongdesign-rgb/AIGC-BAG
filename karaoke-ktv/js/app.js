/**
 * ============================================================
 *  主控制器（KTVApp）：串联 点歌 → 已点队列 → 音频引擎 → 歌词 → 打分 → 录音
 *  交互逻辑对标线下 KTV 点歌机：点歌 / 优先 / 切歌 / 重唱 / 原唱伴唱 / 升降调 / 三路音量
 * ============================================================
 */
(function (global) {
  'use strict';
  const U = global.KTVUtils;
  const { $, $$, fmtTime } = U;
  const { UI, SongPicker, QueuePanel, UploadDialog, BgDialog, SettingsDialog } = global.KTVUI;

  class KTVApp {
    constructor() {
      this.engine = new global.KTVAudio.AudioEngine();
      this.lib = new global.KTVLibrary.SongLibrary();
      this.queue = new global.KTVQueue.PlayQueue();
      this.score = new global.KTVScore.ScoreEngine();
      this.lyrics = new global.KTVLyrics.LyricsView($('#lyrics'));
      this.bg = new global.KTVBackground.BackgroundManager($('#bgLayer'), this.engine);
      this.prefs = {
        defaultVocal: U.prefs.get('defaultVocal', 'accompaniment'),
        scoreOn: U.prefs.get('scoreOn', true),
        font: U.prefs.get('font', 'm'),
        lyricMode: U.prefs.get('lyricMode', 'double'),
      };
      const vol = U.prefs.get('vol', null);
      if (vol) Object.assign(this.engine.vol, vol);
      this.engine.mic.reverb = U.prefs.get('reverb', 0.35);
      this.engine.mic.echoCancel = U.prefs.get('echo', true);
      this.engine.mic.monitor = U.prefs.get('monitor', true);
      this.song = null;
      this.loadingSong = false;
    }

    async start() {
      $('#loading').classList.remove('hidden');
      $('#loadingText').textContent = '正在加载曲库…';
      await this.lib.loadAll((d, n) => { $('#loadingText').textContent = `正在加载曲库 ${d}/${n}…`; });
      $('#loading').classList.add('hidden');
      this.queue.sanitize(this.lib);

      this.picker = new SongPicker(this);
      this.qpanel = new QueuePanel(this);
      this.upload = new UploadDialog(this);
      this.bgDialog = new BgDialog(this);
      this.settings = new SettingsDialog(this);
      UI.initModals();

      this.picker.render();
      this.qpanel.render();
      this.qpanel.loadRecords();
      this.renderIdle();
      await this.bg.init();
      this.lyrics.setMode(this.prefs.lyricMode);
      this.setFont(this.prefs.font);

      this.lib.addEventListener('change', () => { this.picker.render(); this.renderIdle(); this.qpanel.render(); });
      this.queue.addEventListener('change', () => { this.qpanel.render(); this.picker.refreshMarks(); this.updateNext(); this.updateUI(); });
      this.engine.addEventListener('state', () => this.updateUI());
      this.engine.addEventListener('ended', () => this.onSongEnded());
      this.score.addEventListener('line', (e) => this.showLineScore(e.detail));

      // 浏览器自动播放策略：首次交互时启动音频引擎
      const unlock = () => { this.engine.init().catch(() => {}); window.removeEventListener('pointerdown', unlock); };
      window.addEventListener('pointerdown', unlock);

      this.bindControls();
      this.bindKeys();
      this.updateNext();
      this.updateUI();
      this.loop();
      setInterval(() => this.tickClock(), 1000); this.tickClock();
    }

    /* ======================= 点歌 / 播放流程 ======================= */
    orderSong(id, top = false) {
      const s = this.lib.get(id); if (!s) return;
      this.queue.add(id, top);
      UI.toast(`${top ? '已优先' : '已点歌'}：${s.title} - ${s.artist}`, 'ok', 1800);
      if (!this.song && !this.loadingSong) this.playNext();
    }
    playNow(id) { const it = this.queue.playNow(id); this.startSong(it); }

    async playNext(opts = {}) {
      this.hideScore();
      const it = this.queue.next(opts);
      if (it) await this.startSong(it); else this.toIdle();
    }
    async playPrev() {
      const it = this.queue.prev();
      if (!it) { UI.toast('没有上一首了'); return; }
      await this.startSong(it);
    }

    async startSong(item) {
      const song = this.lib.get(item.songId);
      if (!song) { this.queue.current = null; return this.playNext(); }
      this.hideScore();
      // 同步置位，防止连续快速点歌时重复启动；token 用于丢弃过期的加载结果
      this.loadingSong = true;
      const token = (this.loadToken = (this.loadToken || 0) + 1);
      $('#loading').classList.remove('hidden');
      $('#loadingText').textContent = `正在加载《${song.title}》…`;
      await this.finishRecording();
      try {
        await this.engine.load(song);
        if (token !== this.loadToken) return;
      } catch (e) {
        if (token !== this.loadToken) return;
        console.error(e);
        this.loadingSong = false;
        $('#loading').classList.add('hidden');
        UI.toast(`歌曲加载失败：${song.title}（${e.message || e}）`, 'err', 4200);
        this.song = null;
        this.queue.current = null; // 不放回列表循环，避免无限重试
        return this.playNext();
      }
      this.loadingSong = false;
      $('#loading').classList.add('hidden');
      this.song = song;
      this.parsed = global.KTVLyrics.parseLRC(song.lrc || '');
      this.lyrics.setLyrics(this.parsed);
      this.score.reset(this.parsed.lines);
      const dv = this.prefs.defaultVocal;
      const mode = dv === 'keep' ? this.engine.vocalMode : dv;
      this.engine.setVocalMode(this.engine.hasAccompaniment() ? mode : 'original');
      this.engine.play(0);
      this.showIntro(song);
      this.bg.setCover(song.coverUrl);
      this.renderIdle();
      this.updateNext();
      this.picker.refreshMarks();
      this.qpanel.render();
      const nx = this.queue.items[0] && this.lib.get(this.queue.items[0].songId);
      if (nx) setTimeout(() => this.engine.preload(nx), 1500);
      if (this.engine.buffers.instrumentalKind === 'removed') UI.toast('该歌曲无独立伴奏，已自动生成"消音伴奏"', 'info', 3200);
      if (!this.parsed.lines.length) UI.toast('该歌曲暂无歌词', 'info', 2400);
    }

    toIdle() {
      this.finishRecording();
      this.engine.stop();
      this.song = null;
      this.queue.current = null;
      this.lyrics.clear();
      $('#intro').classList.remove('show');
      this.renderIdle();
      this.updateUI();
      this.picker.refreshMarks();
      this.qpanel.render();
    }

    replay() {
      if (!this.song) return;
      this.hideScore();
      const rec = this.engine.recording;
      this.finishRecording().then(() => { if (rec) this.toggleRecord(); });
      this.score.reset(this.parsed.lines);
      this.engine.play(0);
      this.showIntro(this.song);
      UI.toast('重唱', 'info', 1200);
    }

    async onSongEnded() {
      await this.finishRecording();
      const res = this.prefs.scoreOn ? this.score.final() : null;
      if (res) this.showFinalScore(res);
      else this.playNext({ finished: true });
    }

    /* ======================= 演唱控制 ======================= */
    togglePlay() {
      if (this.loadingSong) return;
      if (!this.song) {
        if (this.queue.items.length) this.playNext();
        else UI.toast('请先点歌');
        return;
      }
      if (!this.engine.playing && this.engine.currentTime >= this.engine.duration - 0.1) return this.replay();
      this.engine.toggle();
    }

    toggleVocal() {
      if (!this.song) { UI.toast('请先点歌'); return; }
      const next = this.engine.vocalMode === 'original' ? 'accompaniment' : 'original';
      if (!this.engine.setVocalMode(next)) { UI.toast('该歌曲没有可用的伴奏音轨', 'err'); return; }
      UI.toast(next === 'original' ? '原唱' : '伴唱', 'info', 1000);
    }

    changeKey(d) {
      const n = d === 0 ? 0 : this.engine.semitones + d;
      if (Math.abs(n) > 6) { UI.toast('已到最大调整范围 (±6)', 'info', 1200); return; }
      this.engine.setSemitones(n);
      UI.toast(n === 0 ? '原调' : n > 0 ? `升调 ♯${n}` : `降调 ♭${-n}`, 'info', 900);
    }

    setVolume(kind, v) {
      this.engine.setVolume(kind, v);
      U.prefs.set('vol', this.engine.vol);
    }

    async toggleMic() {
      const e = this.engine;
      if (e.mic.enabled) { e.disableMic(); UI.toast('麦克风已关闭', 'info', 1200); return; }
      try {
        await e.enableMic();
        UI.toast(e.mic.monitor ? '麦克风已开启（建议佩戴耳机，避免啸叫）' : '麦克风已开启（监听关闭）', 'ok', 2600);
      } catch (err) {
        console.error(err);
        const m = err && err.name === 'NotAllowedError' ? '麦克风权限被拒绝，请在浏览器地址栏允许麦克风' :
          err && err.name === 'NotFoundError' ? '未检测到麦克风设备' : '无法开启麦克风：' + (err.message || err);
        UI.toast(m, 'err', 4000);
      }
    }
    setMonitor(on) { this.engine.setMonitor(on); U.prefs.set('monitor', on); $('#sMonitor').checked = on; }

    /* ======================= 录音 ======================= */
    async toggleRecord() {
      const e = this.engine;
      if (e.recording) { await this.finishRecording(true); return; }
      try {
        await e.startRecording();
        this.recSong = this.song;
        UI.toast(e.mic.enabled ? '开始录音（人声 + 伴奏混音）' : '开始录音（未开启麦克风，仅录制伴奏）', 'ok', 2400);
      } catch (err) { UI.toast('录音失败：' + (err.message || err), 'err', 3500); }
    }
    async finishRecording(manual) {
      if (!this.engine.recording) return;
      const res = await this.engine.stopRecording();
      if (!res || res.duration < 1) { if (manual) UI.toast('录音太短，未保存'); return; }
      const s = this.recSong;
      const d = new Date();
      const stamp = `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      const ext = res.blob.type.includes('ogg') ? 'ogg' : res.blob.type.includes('mp4') ? 'm4a' : 'webm';
      const rec = { id: 'r_' + U.uid(), name: s ? `${s.title} - ${s.artist}（我的演唱）` : `自由演唱 ${stamp}`, blob: res.blob,
        duration: res.duration, createdAt: Date.now(), ext };
      try { await this.qpanel.addRecord(rec); } catch (e) {
        console.error(e);
        UI.toast('录音无法保存到浏览器，已直接下载到本地', 'err', 4000);
        U.download(rec.blob, `${U.safeName(rec.name)}.${ext}`);
        return;
      }
      UI.toast('录音已保存，可在右侧「录音」中试听 / 下载', 'ok', 3000);
    }
    async downloadRecord(id, kind) {
      const r = this.qpanel.records.find((x) => x.id === id); if (!r) return;
      const name = U.safeName(r.name);
      if (kind === 'raw') return U.download(r.blob, `${name}.${r.ext}`);
      UI.toast('正在转换为 WAV…', 'info', 1500);
      try { U.download(await this.engine.toWav(r.blob), `${name}.wav`); }
      catch (e) { console.error(e); UI.toast('WAV 转换失败，已下载原始格式', 'err'); U.download(r.blob, `${name}.${r.ext}`); }
    }

    /* ======================= 曲库管理 ======================= */
    async exportSong(id) {
      const s = this.lib.get(id);
      UI.toast('正在生成歌曲包…', 'info', 1500);
      const blob = await this.lib.exportPack(id);
      U.download(blob, U.safeName(`${s.id}.js`));
      UI.toast('已导出：放入 library/songs/ 并登记到 library/manifest.js 即可内置', 'ok', 4200);
    }
    async deleteSong(id) {
      const s = this.lib.get(id);
      if (!confirm(`确定从曲库删除《${s.title}》吗？`)) return;
      this.queue.items = this.queue.items.filter((i) => i.songId !== id);
      this.queue.history = this.queue.history.filter((i) => i.songId !== id);
      await this.lib.removeCustom(id);
      this.queue._changed();
      if (this.song && this.song.id === id) { this.queue.current = null; this.playNext(); }
      UI.toast('已删除', 'ok');
    }

    /* ======================= 画面 ======================= */
    showIntro(song) {
      $('#introCover').src = song.coverUrl;
      $('#introTitle').textContent = song.title;
      $('#introArtist').textContent = song.artist;
      const tags = [];
      tags.push(this.engine.vocalMode === 'original' ? '原唱' : '伴唱');
      if (song.album) tags.push(song.album);
      $('#introMeta').innerHTML = tags.map((t) => `<span>${U.esc(t)}</span>`).join('');
      const first = this.parsed.lines[0];
      this.introUntil = Math.max(3, Math.min(7, first ? first.time - 1.2 : 6));
      $('#intro').classList.add('show');
    }

    showLineScore({ rating }) {
      if (!this.prefs.scoreOn) return;
      const el = document.createElement('div');
      el.className = 'pop ' + rating; el.textContent = rating;
      $('#scorePop').innerHTML = ''; $('#scorePop').appendChild(el);
    }

    showFinalScore(res) {
      $('#scoreSong').textContent = `${this.song.title} - ${this.song.artist}`;
      $('#scoreGrade').textContent = res.grade;
      $('#scoreStars').innerHTML = [0, 1, 2, 3, 4].map((i) => `<svg class="${i < res.stars ? 'on' : ''}" style="animation-delay:${0.3 + i * 0.12}s"><use href="#i-star"/></svg>`).join('');
      $('#scoreCounts').innerHTML = Object.entries(res.counts).map(([k, v]) => `<span>${k}<b>${v}</b></span>`).join('');
      $('#scoreOverlay').classList.remove('hidden');
      // 分数滚动动画
      const num = $('#scoreNum'); const t0 = performance.now();
      const roll = (now) => { const p = Math.min(1, (now - t0) / 1200); num.textContent = Math.round(res.score * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(roll); };
      requestAnimationFrame(roll);
      let n = 8;
      $('#scoreCountdown').textContent = n;
      clearInterval(this.scoreTimer);
      this.scoreTimer = setInterval(() => {
        n--; $('#scoreCountdown').textContent = n;
        if (n <= 0) this.playNext({ finished: true });
      }, 1000);
    }
    hideScore() { clearInterval(this.scoreTimer); $('#scoreOverlay').classList.add('hidden'); }

    renderIdle() {
      const idle = $('#idle');
      idle.classList.toggle('hidden', !!this.song);
      if (this.song) return;
      const recs = this.lib.query('', 'hot').slice(0, 5);
      $('#idleRecs').innerHTML = recs.map((s) => `<div class="rec-card" data-id="${U.esc(s.id)}"><img src="${U.esc(s.coverUrl)}" alt="" /><b>${U.esc(s.title)}</b><small>${U.esc(s.artist)}</small></div>`).join('');
      $$('#idleRecs .rec-card').forEach((c) => c.addEventListener('click', () => this.orderSong(c.dataset.id)));
    }

    updateNext() {
      const it = this.queue.items[0];
      const s = it && this.lib.get(it.songId);
      $('#nextTitle').textContent = s ? `${s.title} - ${s.artist}` : '暂无，快去点歌吧';
    }

    setFont(v) {
      this.prefs.font = v; U.prefs.set('font', v);
      document.body.classList.remove('font-s', 'font-m', 'font-l');
      document.body.classList.add('font-' + v);
      setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
    }

    /** 根据引擎状态刷新按钮与状态标识 */
    updateUI() {
      const e = this.engine, s = this.song;
      $('#npTitle').textContent = s ? s.title : '尚未点歌';
      $('#npArtist').textContent = s ? s.artist : '';
      $('#btnPlay use').setAttribute('href', e.playing ? '#i-pause' : '#i-play');
      const acc = e.vocalMode === 'accompaniment';
      const vs = $('#btnVocal');
      vs.dataset.v = e.vocalMode;
      vs.classList.toggle('disabled', !!s && !e.hasAccompaniment());
      const chip = $('#chipVocal');
      chip.textContent = acc ? (e.buffers && e.buffers.instrumentalKind === 'removed' ? '伴唱 · 消音' : '伴唱') : '原唱';
      chip.className = 'chip chip-vocal ' + e.vocalMode;
      const k = e.semitones;
      $('#keyVal').textContent = k > 0 ? '+' + k : String(k);
      $('#keyVal').className = 'key-val ' + (k > 0 ? 'up' : k < 0 ? 'down' : '');
      $('#chipKey').textContent = k === 0 ? '原调' : k > 0 ? `升 ${k} 调` : `降 ${-k} 调`;
      $('#chipKey').classList.toggle('on', k !== 0);
      $('#chipMic').textContent = e.mic.enabled ? `麦克风 · 开${e.mic.monitor ? ' · 监听' : ''}` : '麦克风 · 关';
      $('#chipMic').classList.toggle('on', e.mic.enabled);
      $('#btnMic').classList.toggle('on', e.mic.enabled);
      $('#btnMic use').setAttribute('href', e.mic.enabled ? '#i-mic' : '#i-mic-off');
      $('#btnMonitor').classList.toggle('on', e.mic.monitor);
      $('#btnRec').classList.toggle('on', e.recording);
      $('#chipRec').classList.toggle('hidden', !e.recording);
      $('#micMeter').classList.toggle('on', e.mic.enabled);
      $('#btnMute').classList.toggle('muted', e.muted);
      $('#btnMute use').setAttribute('href', e.muted ? '#i-mute' : '#i-vol');
      const modeIcon = { sequence: '#i-seq', 'repeat-one': '#i-repeat-one', 'repeat-all': '#i-repeat' }[this.queue.mode];
      $('#btnMode use').setAttribute('href', modeIcon);
      $('#modeLabel').textContent = this.queue.modeName().slice(0, 2);
      $('#stagMode').textContent = this.queue.modeName();
      $('#liveScore').classList.toggle('hidden', !(this.prefs.scoreOn && e.mic.enabled && s));
    }

    /* ======================= 每帧刷新 ======================= */
    loop() {
      const frame = () => {
        const e = this.engine;
        const t = e.currentTime, d = e.duration;
        if (this.song) {
          this.lyrics.update(t);
          if (e.playing) {
            const m = e.readMic();
            if (this.prefs.scoreOn) this.score.sample(t, m.rms, m.pitch, e.mic.enabled);
            $('#micLevel').style.width = Math.min(100, m.rms * 420) + '%';
          }
          if (this.introUntil && t > this.introUntil) { $('#intro').classList.remove('show'); this.introUntil = 0; }
        } else if (e.mic.enabled) {
          $('#micLevel').style.width = Math.min(100, e.readMic().rms * 420) + '%';
        }
        if (!this.dragging) {
          const p = d ? (t / d) * 100 : 0;
          $('#progressFill').style.width = p + '%';
          $('#progressThumb').style.left = p + '%';
          $('#tCur').textContent = fmtTime(t);
        }
        $('#tDur').textContent = fmtTime(d);
        if (e.recording) $('#recTime').textContent = fmtTime((performance.now() - e.recStartedAt) / 1000);
        const ls = $('#liveScore b'); if (ls) ls.textContent = this.score.live;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    }

    tickClock() {
      const d = new Date();
      $('#clock').textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }

    /* ======================= 事件绑定 ======================= */
    bindControls() {
      const on = (id, fn) => $('#' + id).addEventListener('click', fn);
      on('btnPlay', () => this.togglePlay());
      on('btnNext', () => { if (this.song || this.queue.items.length) this.playNext(); else UI.toast('已点列表为空'); });
      on('btnPrev', () => this.playPrev());
      on('btnReplay', () => this.replay());
      on('btnVocal', () => this.toggleVocal());
      on('btnKeyUp', () => this.changeKey(1));
      on('btnKeyDown', () => this.changeKey(-1));
      on('keyVal', () => this.changeKey(0));
      on('btnMute', () => this.engine.setMuted(!this.engine.muted));
      on('btnMic', () => this.toggleMic());
      on('btnMonitor', () => { this.setMonitor(!this.engine.mic.monitor); UI.toast(this.engine.mic.monitor ? '人声监听：开' : '人声监听：关', 'info', 1200); });
      on('btnRec', () => this.toggleRecord());
      on('btnMode', () => { this.queue.cycleMode(); UI.toast(this.queue.modeName(), 'info', 1000); });
      on('btnUpload', () => this.upload.open());
      on('btnBg', () => this.bgDialog.open());
      on('btnSettings', () => this.settings.open());
      on('btnFull', () => this.toggleFullscreen());
      on('scoreNext', () => this.playNext({ finished: true }));
      on('scoreReplay', () => this.replay());
      this.setLyricMode = UI.seg($('#lyricModes'), this.prefs.lyricMode, (v) => {
        this.prefs.lyricMode = v; U.prefs.set('lyricMode', v); this.lyrics.setMode(v);
      });

      [['vMaster', 'master'], ['vMusic', 'music'], ['vMic', 'mic']].forEach(([id, kind]) => {
        const inp = $('#' + id);
        UI.setRange(inp, Math.round(this.engine.vol[kind] * 100));
        $('#' + id + 'Val').textContent = inp.value;
        inp.addEventListener('input', () => {
          UI.paintRange(inp); $('#' + id + 'Val').textContent = inp.value;
          this.setVolume(kind, inp.value / 100);
          if (kind === 'master' && this.engine.muted) this.engine.setMuted(false);
        });
      });

      // 进度条拖动
      const bar = $('#progress'), tip = $('#progressTip');
      const ratio = (ev) => { const r = bar.getBoundingClientRect(); return Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)); };
      bar.addEventListener('pointermove', (ev) => {
        if (!this.engine.duration) return;
        const p = ratio(ev); tip.classList.remove('hidden'); tip.style.left = p * 100 + '%'; tip.textContent = fmtTime(p * this.engine.duration);
        if (this.dragging) { $('#progressFill').style.width = p * 100 + '%'; $('#progressThumb').style.left = p * 100 + '%'; $('#tCur').textContent = fmtTime(p * this.engine.duration); }
      });
      bar.addEventListener('pointerleave', () => { if (!this.dragging) tip.classList.add('hidden'); });
      bar.addEventListener('pointerdown', (ev) => {
        if (!this.song) return;
        this.dragging = true; bar.classList.add('drag'); bar.setPointerCapture(ev.pointerId);
      });
      bar.addEventListener('pointerup', (ev) => {
        if (!this.dragging) return;
        this.dragging = false; bar.classList.remove('drag'); tip.classList.add('hidden');
        this.engine.seek(ratio(ev) * this.engine.duration);
        $('#intro').classList.remove('show'); this.introUntil = 0;
      });
    }

    bindKeys() {
      document.addEventListener('keydown', (e) => {
        if (/input|textarea|select/i.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
        if (!$('#uploadModal').classList.contains('hidden')) return;
        const k = e.key.toLowerCase();
        const map = {
          ' ': () => this.togglePlay(), n: () => this.playNext(), r: () => this.replay(), v: () => this.toggleVocal(),
          m: () => this.engine.setMuted(!this.engine.muted), f: () => this.toggleFullscreen(),
          '+': () => this.changeKey(1), '=': () => this.changeKey(1), '-': () => this.changeKey(-1), _: () => this.changeKey(-1),
          arrowright: () => this.song && this.engine.seek(this.engine.currentTime + 5),
          arrowleft: () => this.song && this.engine.seek(this.engine.currentTime - 5),
        };
        if (map[k]) { e.preventDefault(); map[k](); }
      });
    }

    toggleFullscreen() {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => {});
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    const app = (global.ktvApp = new KTVApp());
    app.start().catch((e) => { console.error(e); UI.toast('初始化失败：' + (e.message || e), 'err', 6000); });
  });
})(window);
