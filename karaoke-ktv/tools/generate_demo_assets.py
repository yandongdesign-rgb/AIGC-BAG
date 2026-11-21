#!/usr/bin/env python3
"""
生成 KTV Demo 曲库素材（仅开发用，最终用户无需运行）
- 5 首原创合成演示歌曲：原唱（含合成人声）+ 伴奏（独立音轨，不含人声）
- 逐字时间轴 LRC 歌词（由旋律时间自动生成，精确对齐）
- 封面 SVG、背景图 JPG、动态背景 MP4
- 打包 library/songs/*.js（音频以 base64 内嵌，保证本地双击 html 即可被 Web Audio 解码）

依赖：python3 + numpy + scipy + pillow + ffmpeg
用法：python3 tools/generate_demo_assets.py
"""
import base64, json, math, os, subprocess, tempfile
import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 44100
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SONG_DIR = os.path.join(ROOT, "assets", "songs")
PACK_DIR = os.path.join(ROOT, "library", "songs")
BG_DIR = os.path.join(ROOT, "assets", "backgrounds")

MAJOR = [0, 2, 4, 5, 7, 9, 11]
MINOR = [0, 2, 3, 5, 7, 8, 10]
PENTA = [0, 2, 4, 7, 9]

def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12.0)

# ---------------------------------------------------------------- 歌曲定义
SONGS = [
    dict(id="demo01", title="星光下的约定", artist="林小夏", album="Demo 演示曲库",
         tags=["hot", "pop"], style="pop", bpm=92, tonic=60, scale=MAJOR, melody_scale=MAJOR,
         prog_v=[0, 4, 5, 3, 0, 4, 5, 3], prog_c=[3, 4, 2, 5, 3, 4, 0, 0],
         colors=("#ff5fd2", "#5b6cff"), seed=11,
         verse=["晚风轻轻吹过城市的街", "霓虹闪烁照亮你的脸", "我们说好不再说再见",
                "把心愿写进夜空里面"],
         chorus=["星光下的约定", "不管多远都会实现", "牵着你的手一起向前", "让爱永远停在这一天"]),
    dict(id="demo02", title="烟雨江南", artist="墨清歌", album="Demo 演示曲库",
         tags=["hot", "guofeng"], style="guofeng", bpm=76, tonic=62, scale=MAJOR, melody_scale=PENTA,
         prog_v=[0, 5, 3, 4, 0, 5, 3, 0], prog_c=[3, 4, 5, 2, 3, 4, 0, 0],
         colors=("#3fe0c5", "#2a4d8f"), seed=23,
         verse=["青石小巷细雨如丝", "油纸伞下谁在等你", "杨柳依依落花有意", "一曲琵琶诉说相思"],
         chorus=["烟雨江南梦里", "桃花又开满了旧城墙", "等你归来共饮一壶酒", "岁月悠悠情意长"]),
    dict(id="demo03", title="南方的风", artist="陈野", album="Demo 演示曲库",
         tags=["folk"], style="folk", bpm=84, tonic=55, scale=MAJOR, melody_scale=MAJOR,
         prog_v=[0, 4, 5, 3, 0, 4, 3, 4], prog_c=[3, 0, 4, 5, 3, 0, 4, 0],
         colors=("#ffb347", "#7a4b2a"), seed=37,
         verse=["背着吉他走过小镇", "阳光洒在旧木门", "路边的花开得认真", "像极了那年的你"],
         chorus=["南方的风吹过", "吹散了我的忧愁", "带我回到那个路口", "你还在那里等我"]),
    dict(id="demo04", title="月光小夜曲", artist="白丽", album="Demo 演示曲库",
         tags=["oldies", "hot"], style="oldies", bpm=70, tonic=65, scale=MAJOR, melody_scale=MAJOR,
         prog_v=[0, 5, 1, 4, 0, 5, 1, 4], prog_c=[3, 4, 2, 5, 1, 4, 0, 0],
         colors=("#f6d365", "#a04a6c"), seed=41,
         verse=["月光洒满窗台", "夜来香悄悄地开", "你的身影慢慢走来", "带着温柔的期待"],
         chorus=["月儿弯弯照心怀", "思念像潮水涌来", "今夜请你不要走开", "陪我唱到天明来"]),
    dict(id="demo05", title="City Lights", artist="Luna Ray", album="Demo Library",
         tags=["english", "hot", "pop"], style="synth", bpm=100, tonic=57, scale=MINOR, melody_scale=MINOR,
         prog_v=[0, 5, 2, 6, 0, 5, 2, 6], prog_c=[5, 6, 0, 0, 5, 6, 4, 4],
         colors=("#00e5ff", "#7c3aed"), seed=53,
         verse=["Walking down the empty street tonight", "Every window burning bright",
                "I can hear your heart beat in the night", "Hold me close and hold me tight"],
         chorus=["City lights are calling me", "Take my hand and we'll be free",
                 "Dancing where the stars can see", "You and me eternally"]),
]

# ---------------------------------------------------------------- 工具
def env_adsr(n, a, d, s, r, sr=SR):
    a, d, r = int(a * sr), int(d * sr), int(r * sr)
    e = np.ones(n) * s
    a = min(a, n); e[:a] = np.linspace(0, 1, a, endpoint=False) if a else e[:a]
    dd = min(d, n - a)
    if dd > 0:
        e[a:a + dd] = np.linspace(1, s, dd)
    rr = min(r, n)
    if rr > 0:
        e[n - rr:] *= np.linspace(1, 0, rr)
    return e

class Mix:
    def __init__(self, seconds):
        self.n = int(seconds * SR) + SR * 4
        self.dry = np.zeros((2, self.n))
        self.rev = np.zeros((2, self.n))

    def add(self, t, sig, gain=1.0, pan=0.0, rev=0.2):
        s = int(t * SR)
        if s >= self.n:
            return
        sig = sig[: self.n - s] * gain
        l = math.cos((pan + 1) * math.pi / 4); r = math.sin((pan + 1) * math.pi / 4)
        self.dry[0, s:s + len(sig)] += sig * l
        self.dry[1, s:s + len(sig)] += sig * r
        if rev:
            self.rev[0, s:s + len(sig)] += sig * l * rev
            self.rev[1, s:s + len(sig)] += sig * r * rev

def make_ir(seconds=2.4, seed=1):
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = rng.standard_normal((2, n)) * np.exp(-t * 3.2)
    b, a = signal.butter(2, 6000 / (SR / 2))
    ir = signal.lfilter(b, a, ir, axis=1)
    ir[:, : int(0.012 * SR)] = 0
    return ir / np.sqrt(np.sum(ir ** 2, axis=1, keepdims=True)) * 0.9

def render(mix, ir):
    out = mix.dry.copy()
    wet = np.stack([signal.fftconvolve(mix.rev[c], ir[c])[: mix.n] for c in range(2)])
    return out + wet

# ---------------------------------------------------------------- 乐器
rng_g = np.random.default_rng(7)

def additive(freq, dur, amps, decays, attack=0.004, release=0.08, inharm=0.0, bend=None):
    n = int((dur + release) * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    f_t = np.full(n, freq) if bend is None else bend(t, freq)
    phase = 2 * np.pi * np.cumsum(f_t) / SR
    for k, (a, dcy) in enumerate(zip(amps, decays), start=1):
        if freq * k > 15000:
            break
        out += a * np.sin(phase * k * (1 + inharm * k * k)) * np.exp(-t * dcy)
    e = np.ones(n)
    na = int(attack * SR); e[:na] = np.linspace(0, 1, na)
    nr = int(release * SR); e[-nr:] *= np.linspace(1, 0, nr)
    return out * e

def piano(m, dur, vel=1.0):
    f = mtof(m)
    amps = [1, 0.5, 0.3, 0.18, 0.12, 0.08, 0.05, 0.03]
    decs = [1.6 + i * 0.9 for i in range(8)]
    return additive(f, dur, amps, decs, inharm=0.0003, release=0.25) * vel

def epiano(m, dur, vel=1.0):
    f = mtof(m)
    s = additive(f, dur, [1, 0.25, 0.12, 0.05, 0.3], [1.2, 2.5, 4, 6, 9], release=0.3)
    n = len(s); t = np.arange(n) / SR
    return s * (1 + 0.15 * np.sin(2 * np.pi * 4.5 * t)) * vel

def pluck(m, dur, bright=1.0, vel=1.0):
    f = mtof(m)
    amps = [1 / (k ** (1.2 / bright)) for k in range(1, 14)]
    decs = [2.2 + k * 1.6 / bright for k in range(1, 14)]
    s = additive(f, dur, amps, decs, attack=0.002, release=0.12, inharm=0.0001)
    nz = rng_g.standard_normal(int(0.01 * SR)) * 0.25 * np.linspace(1, 0, int(0.01 * SR))
    s[: len(nz)] += nz
    return s * vel

def guzheng(m, dur, vel=1.0):
    f = mtof(m)
    def bend(t, f0):
        return f0 * (1 + 0.02 * np.exp(-t * 18) * -1 + 0.006 * np.sin(2 * np.pi * 5.5 * t) * np.clip(t - 0.3, 0, 1))
    amps = [1, 0.7, 0.45, 0.35, 0.22, 0.15, 0.1, 0.07, 0.05, 0.03]
    decs = [1.4 + k * 1.1 for k in range(10)]
    return additive(f, dur, amps, decs, attack=0.002, release=0.3, bend=bend) * vel

def pad(m, dur, vel=1.0, bright=1.0):
    n = int((dur + 0.6) * SR); t = np.arange(n) / SR
    out = np.zeros(n)
    for det in (-0.12, 0.0, 0.11):
        f = mtof(m + det)
        for k in range(1, 12):
            if f * k > 9000: break
            out += np.sin(2 * np.pi * f * k * t + k * det * 7) / (k ** (1.7 / bright))
    return out * env_adsr(n, 0.35, 0.3, 0.8, 0.6) * vel * 0.25

def strings(m, dur, vel=1.0):
    n = int((dur + 0.5) * SR); t = np.arange(n) / SR
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5.2 * t)
    out = np.zeros(n)
    for det in (-0.08, 0.07):
        ph = 2 * np.pi * np.cumsum(mtof(m + det) * vib) / SR
        for k in range(1, 10):
            out += np.sin(ph * k) / (k ** 1.4)
    return out * env_adsr(n, 0.25, 0.2, 0.85, 0.5) * vel * 0.25

def bass(m, dur, vel=1.0, saw=False):
    f = mtof(m)
    if saw:
        amps = [1 / k for k in range(1, 10)]; decs = [1.5 + k * 1.2 for k in range(9)]
    else:
        amps = [1, 0.45, 0.15, 0.08]; decs = [1.2, 2, 3, 4]
    return additive(f, dur, amps, decs, attack=0.006, release=0.08) * vel

def flute(m, dur, vel=1.0):
    n = int((dur + 0.15) * SR); t = np.arange(n) / SR
    vib = 1 + 0.006 * np.sin(2 * np.pi * 5 * t) * np.clip(t * 3 - 0.3, 0, 1)
    ph = 2 * np.pi * np.cumsum(mtof(m) * vib) / SR
    s = np.sin(ph) + 0.25 * np.sin(2 * ph) + 0.08 * np.sin(3 * ph)
    noise = signal.lfilter(*signal.butter(2, [1500 / (SR / 2), 6000 / (SR / 2)], "band"), rng_g.standard_normal(n)) * 0.12
    return (s + noise) * env_adsr(n, 0.06, 0.1, 0.85, 0.15) * vel

def kick(vel=1.0):
    n = int(0.35 * SR); t = np.arange(n) / SR
    f = 50 + 110 * np.exp(-t * 28)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9) * vel

def snare(vel=1.0):
    n = int(0.25 * SR); t = np.arange(n) / SR
    nz = signal.lfilter(*signal.butter(2, [1200 / (SR / 2), 9000 / (SR / 2)], "band"), rng_g.standard_normal(n))
    return (nz * np.exp(-t * 18) * 0.8 + np.sin(2 * np.pi * 190 * t) * np.exp(-t * 25) * 0.5) * vel

def hat(vel=1.0, open_=False):
    n = int((0.25 if open_ else 0.06) * SR); t = np.arange(n) / SR
    nz = signal.lfilter(*signal.butter(2, 7000 / (SR / 2), "high"), rng_g.standard_normal(n))
    return nz * np.exp(-t * (12 if open_ else 70)) * vel

def shaker(vel=1.0):
    n = int(0.09 * SR); t = np.arange(n) / SR
    nz = signal.lfilter(*signal.butter(2, 5000 / (SR / 2), "high"), rng_g.standard_normal(n))
    return nz * np.sin(np.pi * t / t[-1]) ** 2 * vel

def brush(vel=1.0):
    n = int(0.3 * SR); t = np.arange(n) / SR
    nz = signal.lfilter(*signal.butter(2, [800 / (SR / 2), 5000 / (SR / 2)], "band"), rng_g.standard_normal(n))
    return nz * np.sin(np.pi * t / t[-1]) * vel

def tom(m=45, vel=1.0):
    n = int(0.6 * SR); t = np.arange(n) / SR
    f = mtof(m) * (1 + 0.4 * np.exp(-t * 20))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 5) * vel

def clap(vel=1.0):
    n = int(0.2 * SR); t = np.arange(n) / SR
    nz = signal.lfilter(*signal.butter(2, [900 / (SR / 2), 5000 / (SR / 2)], "band"), rng_g.standard_normal(n))
    e = np.exp(-t * 20)
    for off in (0.008, 0.016):
        e += np.exp(-np.clip(t - off, 0, None) * 60) * (t > off) * 0.5
    return nz * e * vel

# ---------------------------------------------------------------- 旋律生成
def chord_tones(scale, root_deg, tonic):
    tones = []
    for i in (0, 2, 4):
        d = root_deg + i
        tones.append(tonic + scale[d % 7] + 12 * (d // 7))
    return tones

def scale_notes(tonic, scale, lo, hi):
    out = []
    for o in range(-3, 4):
        for s in scale:
            m = tonic + 12 * o + s
            if lo <= m <= hi:
                out.append(m)
    return sorted(out)

def tokenize(line):
    if any("a" <= c.lower() <= "z" for c in line):
        words = line.split(" ")
        return [w + (" " if i < len(words) - 1 else "") for i, w in enumerate(words)]
    return list(line)

def rhythm_for(n, rng, beats=7.0):
    durs = [0.5] * n
    extra = beats - 0.5 * n
    if extra < 0:
        durs = [beats / n] * n; extra = 0
    last_add = min(extra, 1.5); durs[-1] += last_add; extra -= last_add
    cands = list(range(1, n - 1))
    rng.shuffle(cands)
    i = 0
    while extra >= 0.5 and cands:
        durs[cands[i % len(cands)]] += 0.5; extra -= 0.5; i += 1
    return durs

def build_melody(song, rng):
    """返回 (notes, lines)：notes = [(t, dur, midi)]，lines = [{'start','tokens':[(t,dur,text)]}]"""
    bpm = song["bpm"]; beat = 60.0 / bpm; bar = 4 * beat
    tonic = song["tonic"]; mscale = song["melody_scale"]
    allowed = scale_notes(tonic, mscale, tonic - 3, tonic + 17)
    sections = [("intro", 2), ("verse", 8), ("chorus", 8), ("inter", 2), ("chorus2", 4), ("outro", 2)]
    bar_chords = []
    for name, nb in sections:
        if name == "verse": bar_chords += song["prog_v"]
        elif name == "chorus": bar_chords += song["prog_c"]
        elif name == "chorus2": bar_chords += song["prog_c"][4:]
        elif name == "intro": bar_chords += song["prog_v"][:2]
        elif name == "inter": bar_chords += song["prog_v"][2:4]
        else: bar_chords += [0, 0]
    notes, lines = [], []
    rhythm_cache = {}
    bar_i = 0
    for name, nb in sections:
        if name in ("verse", "chorus", "chorus2"):
            texts = song["verse"] if name == "verse" else (song["chorus"] if name == "chorus" else song["chorus"][2:])
            lo_idx = 0 if name == "verse" else 3
            for li, text in enumerate(texts):
                toks = tokenize(text)
                key = (name.rstrip("2"), len(toks))
                if key not in rhythm_cache:
                    rhythm_cache[key] = rhythm_for(len(toks), rng)
                durs = rhythm_cache[key]
                t = (bar_i + li * 2) * bar
                idx_base = allowed.index(min(allowed, key=lambda m: abs(m - (tonic + (4 if lo_idx else 0)))))
                idx = idx_base + rng.integers(-1, 3)
                pos = 0.0
                line_tokens = []
                for k, (tok, d) in enumerate(zip(toks, durs)):
                    bar_no = bar_i + li * 2 + int(pos // 4)
                    chord = chord_tones(song["scale"], bar_chords[bar_no], tonic)
                    chord_pcs = {c % 12 for c in chord}
                    prog = k / max(1, len(toks) - 1)
                    step = rng.choice([-2, -1, -1, 0, 1, 1, 1, 2]) if prog < 0.55 else rng.choice([-2, -1, -1, 0, 1])
                    idx = int(np.clip(idx + step, idx_base - 2 + (2 if name != "verse" else 0), idx_base + 6))
                    m = allowed[idx]
                    strong = (pos % 2 == 0) or k == len(toks) - 1
                    if strong:
                        cands = [a for a in allowed if a % 12 in chord_pcs]
                        if cands:
                            m = min(cands, key=lambda a: abs(a - m))
                            idx = allowed.index(m) if m in allowed else idx
                    if k == len(toks) - 1 and li == len(texts) - 1:
                        cands = [a for a in allowed if a % 12 == tonic % 12]
                        m = min(cands, key=lambda a: abs(a - m)); idx = allowed.index(m)
                    st = t + pos * beat
                    notes.append((st, d * beat * 0.95, m))
                    line_tokens.append((st, d * beat, tok))
                    pos += d
                lines.append(dict(start=line_tokens[0][0], tokens=line_tokens, section=name))
        bar_i += nb
    total = bar_i * bar
    return notes, lines, bar_chords, total

# ---------------------------------------------------------------- 合成人声
VOWELS = {
    "a": [(800, 80, 1.0), (1150, 90, 0.5), (2900, 120, 0.12), (3900, 130, 0.05)],
    "o": [(450, 70, 1.0), (800, 80, 0.35), (2830, 100, 0.08), (3800, 120, 0.03)],
    "e": [(500, 70, 1.0), (1500, 90, 0.35), (2500, 120, 0.12), (3500, 130, 0.05)],
    "i": [(320, 60, 1.0), (2300, 100, 0.25), (3000, 120, 0.15), (3700, 130, 0.06)],
    "u": [(340, 60, 1.0), (750, 70, 0.25), (2400, 100, 0.05), (3500, 120, 0.02)],
}
VOWEL_ORDER = ["a", "o", "e", "a", "i", "u", "a", "e"]

def vocal_track(notes, total, tokens, seed=0):
    rng = np.random.default_rng(seed)
    n = int((total + 4) * SR)
    f0 = np.zeros(n); amp = np.zeros(n)
    F = {i: np.zeros(n) for i in range(4)}; B = {i: np.ones(n) * 100 for i in range(4)}; G = {i: np.zeros(n) for i in range(4)}
    cons = np.zeros(n)
    prev_end, prev_f = -1, None
    for (t, d, m), tok in zip(notes, tokens):
        s, e = int(t * SR), int((t + d) * SR)
        L = e - s
        tt = np.arange(L) / SR
        f = mtof(m)
        fr = np.full(L, f)
        legato = prev_f is not None and t - prev_end < 0.08
        if legato:
            g = int(min(0.06, d * 0.3) * SR)
            fr[:g] = prev_f * (f / prev_f) ** (np.linspace(0, 1, g) ** 0.7)
        vib_depth = 0.012 * np.clip((tt - 0.22) / 0.3, 0, 1)
        fr *= 1 + vib_depth * np.sin(2 * np.pi * 5.6 * tt + rng.uniform(0, 6))
        fr *= 1 + 0.002 * rng.standard_normal(L).cumsum() / np.sqrt(np.arange(1, L + 1))
        f0[s:e] = fr
        a_env = env_adsr(L, 0.03 if legato else 0.05, 0.1, 0.85, min(0.09, d * 0.4))
        a_env *= 1 + 0.05 * np.sin(2 * np.pi * 5.6 * tt)
        amp[s:e] = np.maximum(amp[s:e], a_env)
        v = VOWEL_ORDER[(ord(tok.strip()[0]) if tok.strip() else 97) % len(VOWEL_ORDER)]
        for i, (fq, bw, gg) in enumerate(VOWELS[v]):
            F[i][s:e] = fq; B[i][s:e] = bw; G[i][s:e] = gg
        if not legato or rng.random() < 0.5:
            cl = int(0.025 * SR)
            cons[s:s + cl] += np.linspace(1, 0, cl) ** 2
        prev_end, prev_f = t + d, f
    # 平滑共振峰过渡
    win = np.hanning(int(0.03 * SR)); win /= win.sum()
    for i in range(4):
        # 未发声区间保持上一个值以免平滑时跳到 0
        mask = F[i] == 0
        idx = np.where(~mask, np.arange(n), 0); np.maximum.accumulate(idx, out=idx)
        F[i] = F[i][idx]; G[i] = G[i][idx]; B[i] = B[i][idx]
        F[i] = np.convolve(F[i], win, "same"); G[i] = np.convolve(G[i], win, "same")
    fidx = np.where(f0 > 0, np.arange(n), 0); np.maximum.accumulate(fidx, out=fidx)
    f0h = f0[fidx]; f0h[f0h == 0] = 220
    phase = 2 * np.pi * np.cumsum(f0h) / SR
    out = np.zeros(n)
    for k in range(1, 40):
        hf = f0h * k
        if np.min(hf) > 5500: break
        g = np.zeros(n)
        for i in range(4):
            g += G[i] / (1 + ((hf - F[i]) / B[i]) ** 2)
        g = (g + 0.02) / (k ** 0.9)
        g[hf > 6000] = 0
        out += g * np.sin(phase * k)
    breath = signal.lfilter(*signal.butter(2, [2000 / (SR / 2), 8000 / (SR / 2)], "band"), rng.standard_normal(n))
    out = out * amp + breath * amp * 0.015
    cons_n = signal.lfilter(*signal.butter(2, 3500 / (SR / 2), "high"), rng.standard_normal(n)) * cons * 0.08
    out += cons_n
    out = signal.lfilter(*signal.butter(1, 90 / (SR / 2), "high"), out)
    return out / (np.max(np.abs(out)) + 1e-9)

# ---------------------------------------------------------------- 伴奏编配
def arrange(song, mix, bar_chords, total, notes):
    bpm = song["bpm"]; beat = 60.0 / bpm; bar = 4 * beat
    tonic = song["tonic"]; scale = song["scale"]; style = song["style"]
    nbars = len(bar_chords)
    sec_of_bar = (["intro"] * 2 + ["verse"] * 8 + ["chorus"] * 8 + ["inter"] * 2 + ["chorus"] * 4 + ["outro"] * 2)
    for b, ch in enumerate(bar_chords):
        t0 = b * bar
        sec = sec_of_bar[b]
        last = b == nbars - 1
        energy = {"intro": 0.6, "verse": 0.8, "chorus": 1.0, "inter": 0.85, "outro": 0.6}[sec]
        tones = chord_tones(scale, ch, tonic - 12)
        root = tones[0] - 12
        while root < 36: root += 12
        if last:
            # 结尾和弦长音
            for m in tones:
                mix.add(t0, piano(m, 3.5 * beat, 0.5), 0.5, rev=0.4)
            mix.add(t0, bass(root, 3.5 * beat, 0.9), 0.5, rev=0.05)
            if style in ("pop", "synth"): mix.add(t0, kick(0.9), 0.55, rev=0)
            continue
        if style == "pop":
            for m in tones:
                mix.add(t0, epiano(m, 1.9 * beat, 0.55), 0.35, pan=-0.2, rev=0.3)
                mix.add(t0 + 2 * beat, epiano(m, 1.9 * beat, 0.5), 0.35, pan=-0.2, rev=0.3)
                mix.add(t0, pad(m + 12, 4 * beat, 0.5), 0.12 * energy, pan=0.3, rev=0.5)
            for bt, v in ((0, 1), (1.5, 0.7), (2, 0.9), (3.5, 0.6)):
                mix.add(t0 + bt * beat, bass(root, 0.45 * beat if bt % 1 else 0.9 * beat, v), 0.5, rev=0.03)
            if sec != "intro":
                for bt in (0, 1.5, 2.5): mix.add(t0 + bt * beat, kick(1), 0.55 * energy, rev=0)
                for bt in (1, 3): mix.add(t0 + bt * beat, snare(1), 0.32 * energy, pan=0.05, rev=0.25)
                for i in range(8): mix.add(t0 + i * 0.5 * beat, hat(0.8 if i % 2 else 0.5), 0.12 * energy, pan=0.35, rev=0.05)
            if sec == "chorus":
                arp = tones + [tones[0] + 12]
                for i in range(8):
                    mix.add(t0 + i * 0.5 * beat, pluck(arp[i % 4] + 12, 0.5 * beat, 1.3, 0.5), 0.18, pan=0.5 - (i % 2), rev=0.35)
        elif style == "guofeng":
            pent = [tonic - 12 + s + 12 * o for o in (0, 1) for s in PENTA]
            base = [p for p in pent if p >= tones[0]][:6]
            pattern = [0, 2, 4, 5, 3, 1, 2, 4]
            for i in range(8):
                mix.add(t0 + i * 0.5 * beat, guzheng(base[pattern[i] % len(base)], 1.0 * beat, 0.6 if i % 2 else 0.85), 0.28, pan=-0.35, rev=0.45)
            for m in tones:
                mix.add(t0, strings(m + 12, 4 * beat, 0.5), 0.16 * energy, pan=0.35, rev=0.6)
            mix.add(t0, bass(root, 1.8 * beat, 0.8), 0.4, rev=0.1)
            mix.add(t0 + 2 * beat, bass(root + 7, 1.8 * beat, 0.6), 0.35, rev=0.1)
            if sec in ("chorus", "inter"):
                mix.add(t0, tom(43, 1), 0.4, rev=0.4)
                mix.add(t0 + 2.5 * beat, tom(47, 0.6), 0.3, rev=0.4)
                mix.add(t0 + 3 * beat, tom(43, 0.7), 0.3, rev=0.4)
            if sec in ("intro", "inter", "outro"):
                # 笛子过门：复用副歌旋律片段
                src0 = 10 * bar + (b % 2) * bar
                for (nt, nd, nm) in notes:
                    if src0 <= nt < src0 + bar:
                        mix.add(t0 + nt - src0, flute(nm + 12, nd, 0.8), 0.22, pan=0.2, rev=0.5)
        elif style == "folk":
            pat = [tones[0], tones[1] + 12, tones[2], tones[1] + 12, tones[0] + 12, tones[2], tones[1] + 12, tones[2]]
            for i in range(8):
                mix.add(t0 + i * 0.5 * beat, pluck(pat[i], 1.6 * beat, 1.0, 0.7 if i % 2 else 0.9), 0.3, pan=-0.3, rev=0.25)
            if sec in ("chorus",):
                for bt in (1, 3):
                    for j, m in enumerate(sorted(tones + [tones[0] + 12])):
                        mix.add(t0 + bt * beat + j * 0.012, pluck(m + 12, 0.9 * beat, 1.4, 0.4), 0.18, pan=0.4, rev=0.3)
            mix.add(t0, bass(root, 1.8 * beat, 0.8), 0.42, rev=0.05)
            mix.add(t0 + 2 * beat, bass(root + 7 if root + 7 < 60 else root - 5, 1.8 * beat, 0.7), 0.38, rev=0.05)
            if sec != "intro":
                for i in range(8): mix.add(t0 + i * 0.5 * beat, shaker(0.9 if i % 2 else 0.5), 0.1 * energy, pan=0.45, rev=0.1)
                mix.add(t0, kick(0.7), 0.35, rev=0); mix.add(t0 + 2 * beat, kick(0.6), 0.3, rev=0)
                mix.add(t0 + 1 * beat, snare(0.4), 0.15, rev=0.3); mix.add(t0 + 3 * beat, snare(0.4), 0.15, rev=0.3)
        elif style == "oldies":
            for m in tones:
                mix.add(t0, strings(m + 12, 4 * beat, 0.6), 0.2 * energy, pan=0.3, rev=0.6)
            mix.add(t0, piano(tones[0], 1 * beat, 0.8), 0.32, pan=-0.25, rev=0.4)
            for bt in (1, 2, 3):
                for m in tones[1:] + [tones[0] + 12]:
                    mix.add(t0 + bt * beat, piano(m, 0.9 * beat, 0.45), 0.22, pan=-0.25, rev=0.4)
            walk = [root, root + 4 if (root + 4) % 12 in {(tonic + s) % 12 for s in scale} else root + 3, root + 7, root + 9]
            for i, m in enumerate(walk):
                mix.add(t0 + i * beat, bass(m, 0.9 * beat, 0.8), 0.42, rev=0.08)
            if sec != "intro":
                for bt in (0, 1, 2, 3): mix.add(t0 + bt * beat, brush(0.7 if bt % 2 else 0.4), 0.12, pan=0.2, rev=0.2)
        elif style == "synth":
            for m in tones:
                p = pad(m + 12, 4 * beat, 0.6, bright=1.3)
                pump = 1 - 0.6 * np.exp(-((np.arange(len(p)) / SR) % beat) * 9)
                mix.add(t0, p * pump, 0.16 * energy, pan=0.25, rev=0.5)
            for i in range(8):
                mix.add(t0 + i * 0.5 * beat, bass(root + (12 if i % 2 else 0), 0.45 * beat, 0.8, saw=True), 0.28, rev=0.02)
            arp = [tones[0] + 12, tones[1] + 12, tones[2] + 12, tones[1] + 24]
            for i in range(16 if sec == "chorus" else 8):
                step = 0.25 if sec == "chorus" else 0.5
                mix.add(t0 + i * step * beat, pluck(arp[i % 4], step * beat, 1.6, 0.5), 0.13, pan=-0.5 + (i % 2), rev=0.4)
            if sec != "intro":
                for bt in range(4): mix.add(t0 + bt * beat, kick(1), 0.55, rev=0)
                for bt in (1, 3): mix.add(t0 + bt * beat, clap(1), 0.28, rev=0.3)
                for i in range(4): mix.add(t0 + (i + 0.5) * beat, hat(1, open_=True), 0.1, pan=0.3, rev=0.1)

# ---------------------------------------------------------------- 输出
def fmt_ts(t):
    m = int(t // 60); s = t - 60 * m
    return f"{m:02d}:{s:05.2f}"

def write_lrc(song, lines, path):
    out = [f"[ti:{song['title']}]", f"[ar:{song['artist']}]", f"[al:{song['album']}]", "[by:KTV Demo Generator]", "[offset:0]"]
    for ln in lines:
        seg = "".join(f"<{fmt_ts(t)}>{tok}" for t, d, tok in ln["tokens"])
        end = ln["tokens"][-1][0] + ln["tokens"][-1][1] * 0.9
        out.append(f"[{fmt_ts(ln['start'])}]{seg}<{fmt_ts(end)}>")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")
    return "\n".join(out) + "\n"

def to_mp3(stereo, path, kbps=80):
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        wavfile.write(tmp.name, SR, (np.clip(stereo.T, -1, 1) * 32767).astype(np.int16))
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp.name, "-codec:a", "libmp3lame",
                        "-b:a", f"{kbps}k", path], check=True)
        os.unlink(tmp.name)

def cover_svg(song):
    c1, c2 = song["colors"]
    title = song["title"]
    fs = 30 if len(title) <= 6 else 24
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300" width="300" height="300">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{c1}"/><stop offset="1" stop-color="{c2}"/></linearGradient>
    <radialGradient id="r" cx="0.7" cy="0.3" r="0.7"><stop offset="0" stop-color="#fff" stop-opacity="0.45"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="300" height="300" fill="#0b1026"/>
  <rect width="300" height="300" fill="url(#g)" opacity="0.85"/>
  <rect width="300" height="300" fill="url(#r)"/>
  <g fill="none" stroke="#fff" stroke-opacity="0.35" stroke-width="2">
    <circle cx="210" cy="95" r="58"/><circle cx="210" cy="95" r="38"/><circle cx="210" cy="95" r="8" fill="#fff" fill-opacity="0.6"/>
  </g>
  <path d="M0 230 Q75 190 150 228 T300 222 V300 H0 Z" fill="#000" fill-opacity="0.28"/>
  <text x="24" y="242" font-family="PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="{fs}" font-weight="700" fill="#fff">{title}</text>
  <text x="24" y="272" font-family="PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="16" fill="#fff" fill-opacity="0.8">{song['artist']}</text>
</svg>'''

def make_song(song):
    print("==>", song["title"])
    rng = np.random.default_rng(song["seed"])
    notes, lines, bar_chords, total = build_melody(song, rng)
    toks = [tk for ln in lines for (_, _, tk) in ln["tokens"]]
    ir = make_ir(seed=song["seed"])
    acc = Mix(total)
    arrange(song, acc, bar_chords, total, notes)
    acc_st = render(acc, ir)
    voc = vocal_track(notes, total, toks, seed=song["seed"])
    vm = Mix(total)
    vm.add(0, voc[: vm.n], 1.0, pan=0.0, rev=0.28)
    # 轻微延迟回声
    d = int(60 / song["bpm"] * 0.75 * SR)
    vm.dry[:, d:] += 0.12 * vm.dry[:, :-d].copy()
    voc_st = render(vm, ir)
    # 混音电平：人声相对伴奏
    acc_rms = np.sqrt(np.mean(acc_st ** 2)); voc_rms = np.sqrt(np.mean(voc_st ** 2))
    voc_st *= acc_rms / voc_rms * 1.05
    orig = acc_st + voc_st
    g = 0.89 / np.max(np.abs(orig))
    orig *= g; acc_st = acc_st * g
    n_end = int((total + 2.5) * SR)
    fade = np.ones(n_end); fade[-int(1.5 * SR):] = np.linspace(1, 0, int(1.5 * SR))
    orig = orig[:, :n_end] * fade; acc_st = acc_st[:, :n_end] * fade
    sd = os.path.join(SONG_DIR, song["id"]); os.makedirs(sd, exist_ok=True)
    to_mp3(orig, os.path.join(sd, "original.mp3"))
    to_mp3(acc_st, os.path.join(sd, "instrumental.mp3"))
    lrc = write_lrc(song, lines, os.path.join(sd, "lyrics.lrc"))
    with open(os.path.join(sd, "cover.svg"), "w", encoding="utf-8") as f:
        f.write(cover_svg(song))
    def b64(p):
        with open(p, "rb") as f:
            return "data:audio/mpeg;base64," + base64.b64encode(f.read()).decode()
    meta = dict(id=song["id"], title=song["title"], artist=song["artist"], album=song["album"],
                tags=song["tags"], duration=round(n_end / SR, 2),
                cover=f"assets/songs/{song['id']}/cover.svg")
    js = ["/* 自动生成的 Demo 歌曲包：%s - %s（音频为 base64 内嵌 MP3，便于本地 file:// 直接运行） */" % (song["artist"], song["title"]),
          "KTV.registerSong(Object.assign(%s, {" % json.dumps(meta, ensure_ascii=False),
          "  lrc: %s," % json.dumps(lrc, ensure_ascii=False),
          "  original: \"%s\"," % b64(os.path.join(sd, "original.mp3")),
          "  instrumental: \"%s\"" % b64(os.path.join(sd, "instrumental.mp3")),
          "}));", ""]
    with open(os.path.join(PACK_DIR, song["id"] + ".js"), "w", encoding="utf-8") as f:
        f.write("\n".join(js))

# ---------------------------------------------------------------- 背景素材
def make_backgrounds():
    from PIL import Image, ImageFilter
    W, H = 1920, 1080
    rng = np.random.default_rng(3)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)

    def save(arr, name):
        img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
        img.save(os.path.join(BG_DIR, name), quality=86)

    # 1. 霓虹城市夜景（散景）
    base = np.zeros((H, W, 3), np.float32)
    top = np.array([8, 10, 32]); bot = np.array([40, 12, 60])
    base += top + (bot - top) * (yy / H)[..., None]
    img = Image.fromarray(base.astype(np.uint8))
    layer = np.zeros((H, W, 3), np.float32)
    cols = [(255, 79, 216), (62, 232, 255), (139, 92, 246), (255, 180, 80)]
    for _ in range(90):
        cx, cy = rng.uniform(0, W), rng.uniform(H * 0.35, H)
        r = rng.uniform(15, 90); c = np.array(cols[rng.integers(0, 4)])
        d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
        layer += c * (np.clip(1 - d / r, 0, 1) ** 0.6 * rng.uniform(0.15, 0.5))[..., None]
    for _ in range(60):  # 远处楼宇灯
        x0 = rng.uniform(0, W); w = rng.uniform(40, 140); h = rng.uniform(150, 600)
        m = (xx > x0) & (xx < x0 + w) & (yy > H - h)
        layer[m] += np.array([10, 12, 30])
    arr = np.asarray(img, np.float32) + layer
    arr = np.asarray(Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(6)), np.float32)
    save(arr, "neon-city.jpg")

    # 2. 极光
    arr = np.zeros((H, W, 3), np.float32) + np.array([4, 8, 24])
    for i, c in enumerate([(40, 255, 200), (90, 120, 255), (200, 80, 255)]):
        phase = rng.uniform(0, 6)
        center = H * (0.35 + 0.12 * i) + 80 * np.sin(xx / W * 2 * np.pi * (1 + i * 0.4) + phase)
        band = np.exp(-((yy - center) / (90 + 30 * i)) ** 2)
        streak = 0.6 + 0.4 * np.sin(xx / 13.0 + phase) ** 2
        arr += np.array(c) * (band * streak * 0.55)[..., None]
    stars = rng.random((H, W)) > 0.9993
    arr[stars] = 230
    save(arr, "aurora.jpg")

    # 3. 舞台光束
    arr = np.zeros((H, W, 3), np.float32) + np.array([6, 6, 18])
    for (sx, ang, c) in [(0.2, 0.35, (255, 79, 216)), (0.5, 0.0, (62, 232, 255)), (0.8, -0.35, (139, 92, 246)),
                          (0.35, 0.15, (255, 200, 120)), (0.65, -0.15, (90, 160, 255))]:
        ox = sx * W
        dx = xx - ox; dy = yy + 50
        a = np.arctan2(dx, dy) - ang
        beam = np.exp(-(a / 0.09) ** 2) * np.clip(1 - dy / (H * 1.3), 0, 1)
        arr += np.array(c) * (beam * 0.7)[..., None]
    floor = np.exp(-((yy - H) / 180) ** 2)
    arr += np.array([60, 30, 90]) * floor[..., None]
    arr = np.asarray(Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(3)), np.float32)
    save(arr, "stage.jpg")

def make_video():
    """无缝循环的霓虹光斑动态背景（MP4，静音）"""
    W, H, FPS, SEC = 960, 540, 24, 10
    N = FPS * SEC
    rng = np.random.default_rng(9)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    blobs = []
    cols = [(255, 79, 216), (62, 232, 255), (139, 92, 246), (255, 170, 90), (80, 120, 255)]
    for _ in range(26):
        blobs.append(dict(cx=rng.uniform(0, W), cy=rng.uniform(0, H), ax=rng.uniform(30, 160), ay=rng.uniform(20, 90),
                          k=rng.integers(1, 3), ph=rng.uniform(0, 6.28), r=rng.uniform(25, 110),
                          c=np.array(cols[rng.integers(0, 5)], np.float32), a=rng.uniform(0.25, 0.6)))
    path = os.path.join(BG_DIR, "neon-loop.mp4")
    p = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                          "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "30",
                          "-preset", "slow", "-movflags", "+faststart", path], stdin=subprocess.PIPE)
    base = np.array([6, 8, 26], np.float32) + (np.array([28, 10, 48], np.float32) - np.array([6, 8, 26])) * (yy / H)[..., None]
    for f in range(N):
        t = f / N * 2 * np.pi
        fr = base.copy()
        for b in blobs:
            cx = b["cx"] + b["ax"] * np.sin(t * b["k"] + b["ph"]); cy = b["cy"] + b["ay"] * np.cos(t * b["k"] + b["ph"])
            x0, x1 = int(max(0, cx - b["r"])), int(min(W, cx + b["r"])); y0, y1 = int(max(0, cy - b["r"])), int(min(H, cy + b["r"]))
            if x1 <= x0 or y1 <= y0: continue
            d = np.sqrt((xx[y0:y1, x0:x1] - cx) ** 2 + (yy[y0:y1, x0:x1] - cy) ** 2) / b["r"]
            pulse = 0.75 + 0.25 * np.sin(t * 2 * b["k"] + b["ph"])
            fr[y0:y1, x0:x1] += b["c"] * (np.clip(1 - d, 0, 1) ** 1.5 * b["a"] * pulse)[..., None]
        p.stdin.write(np.clip(fr, 0, 255).astype(np.uint8).tobytes())
    p.stdin.close(); p.wait()

if __name__ == "__main__":
    os.makedirs(SONG_DIR, exist_ok=True); os.makedirs(PACK_DIR, exist_ok=True); os.makedirs(BG_DIR, exist_ok=True)
    import sys
    only = sys.argv[1:]
    for s in SONGS:
        if not only or s["id"] in only:
            make_song(s)
    if not only or "bg" in only:
        make_backgrounds(); make_video()
    with open(os.path.join(ROOT, "library", "manifest.js"), "w", encoding="utf-8") as f:
        f.write("""/**
 * 曲库清单：列出 library/songs/ 目录下需要加载的歌曲包文件名。
 * 新增歌曲包（应用内「导出歌曲包」得到的 .js 文件）后，把文件名加到这里即可。
 */
window.KTV_LIBRARY_MANIFEST = [
%s
];
""" % "\n".join(f'  "{s["id"]}.js",' for s in SONGS))
    print("done")
