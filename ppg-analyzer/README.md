# 指尖 PPG 实验室（Fingertip PPG Lab）

纯网页、零外设、无创的指尖光电容积脉搏波（PPG）分析小应用。手机后置摄像头 + 闪光灯采集指尖血流信号，实时绘制脉搏波形，计算脉率、脉搏间期与 HRV 特征。面向生物医学工程本科教学与课程实验。

> ⚠️ 仅用于教学与实验，**不能用于医疗诊断**。

## 快速使用

1. 摄像头 API 只能在 **HTTPS 或 localhost** 下使用。任选一种方式：
   - **GitHub Pages**：仓库 Settings → Pages → 选择分支，访问 `https://<用户名>.github.io/<仓库>/ppg-analyzer/`
   - **本地调试**：`cd ppg-analyzer && python3 -m http.server 8000`，电脑访问 `http://localhost:8000`（手机访问局域网 IP 不是 HTTPS，需要用 Pages 或其他 HTTPS 方式）
2. 手机竖屏打开 → 点「开始测量」→ 允许摄像头 → 指腹**轻压**并同时盖住后置摄像头和闪光灯。
3. 保持静止，信号质量条 > 0.5 后开始计数心搏。频域 HRV 建议测 ≥ 2 分钟，标准短时 HRV 为 5 分钟。
4. 测量结束后可「导出 CSV」（原始 RGB 均值 + 每搏间期），用 MATLAB / Python 继续分析。

| 平台 | 说明 |
|---|---|
| Android Chrome / Edge | 支持自动打开闪光灯 ✅ |
| iOS Safari / 微信 | 多数版本不能通过网页打开闪光灯，请在明亮灯光下测量（环境光透射也能得到 PPG） |

## 显示指标

| 指标 | 含义 |
|---|---|
| **PR 脉率** | Pulse Rate，监护仪通用缩写，= 60000 / 近 8 个有效 PPI 的中位数 (bpm) |
| **PPI 脉搏间期** | 相邻收缩期峰的间隔 (ms)，相当于 ECG 的 RR 间期。注意：PPG 没有 P 波，无法测 ECG 意义上的 PR 间期 |
| **PI 灌注指数** | AC / DC × 100% |
| **SQI** | 频谱信号质量：心率主频及二次谐波 ±0.15 Hz 内的功率占通带功率比例 |
| 时域 HRV | MeanNN、SDNN、RMSSD、pNN50（+ SDSD、CVNN，在 `summary()` 结果中） |
| 非线性 | Poincaré SD1、SD2 |
| 频域 HRV | LF (0.04–0.15 Hz)、HF (0.15–0.4 Hz)、LF/HF、LFnu、HFnu |
| 形态学 | 上升时间（足→峰，crest time） |

## 信号处理流程

```
摄像头帧 → 中心 ROI 的 R/G/B 均值（js/camera.js）
  → 手指检测（亮度 + R/G 比）
  → 取反（透射式：血容量↑ 透光↓）
  → 线性插值重采样到 fs = 30 Hz（帧间隔有抖动）
  → 线性去趋势
  → 4 阶 Butterworth 带通 0.5–4 Hz，二阶节级联 + filtfilt 零相位
  → 峰值检测：Elgendi 2013 双滑动平均法 / 自适应阈值局部极大值
  → 抛物线插值得到亚采样精度峰时刻（30 fps 下单帧 33 ms，对 HRV 太粗）
  → PPI 伪迹剔除（生理范围 40–180 bpm + 与近 9 个间期中位数偏差 ≤ 25%）
  → HRV：时域 / Poincaré / 4 Hz 重采样 + Welch(Hann) 功率谱
  → 智能解读（规则引擎）
```

参考文献：
- Task Force of ESC & NASPE. *Heart rate variability: standards of measurement...* Circulation, 1996.
- Elgendi M. et al. *Systolic peak detection in acceleration photoplethysmograms measured from emergency responders in tropical conditions.* PLoS ONE, 2013.
- Shaffer F., Ginsberg J.P. *An overview of heart rate variability metrics and norms.* Front. Public Health, 2017.

## 代码结构

```
ppg-analyzer/
├── index.html            页面结构
├── css/style.css         样式（手机竖屏，自动深色模式）
├── js/
│   ├── config.js         ★ 所有实验参数 + 参数面板描述 PARAM_SCHEMA
│   ├── camera.js         摄像头 / 闪光灯 / ROI 取均值
│   ├── pipeline.js       ★ PPGProcessor：完整处理流水线（无 DOM，可离线运行）
│   ├── dsp/
│   │   ├── filters.js    重采样、去趋势、Butterworth 设计、sosfilt、filtfilt、FILTERS 注册表
│   │   ├── peaks.js      峰值检测、DETECTORS 注册表、足点检测
│   │   ├── spectrum.js   FFT、周期图、Welch、频带功率、SQI
│   │   └── hrv.js        间期清洗、HRV 特征、FEATURES 注册表
│   ├── analysis/insight.js  智能解读、ANALYZERS 注册表
│   ├── ui/charts.js      Canvas 绘图（波形、间期趋势、Poincaré、PSD）
│   └── main.js           界面胶水层
└── tests/
    ├── synthetic.js      合成 PPG 生成器（已知真值，可作“金标准”）
    └── run-tests.mjs     node tests/run-tests.mjs
```

## 修改实验参数

- **临时修改**：页面右上角 ⚙，修改后立即生效并保存在本机浏览器。
- **修改默认值**：编辑 `js/config.js` 中的 `DEFAULT_CONFIG`。
- **让新参数出现在面板中**：在 `PARAM_SCHEMA` 中加一行，例如
  `{ group: '带通滤波', key: 'myParam', label: '我的参数', type: 'number', step: 0.1 }`。

## 算法拓展接口

四类注册表，新增算法不需要改动流水线代码。可以写在 `main.js` 中，也可以在浏览器控制台通过 `window.PPGLab` 现场试验：

```js
import { registerFilter } from './dsp/filters.js';
import { registerDetector } from './dsp/peaks.js';
import { registerFeature } from './dsp/hrv.js';
import { registerAnalyzer } from './analysis/insight.js';

// 1) 新滤波器：(x, fs, cfg) => Float64Array，然后在 config 中设 filter: 'median5'
registerFilter('median5', (x) => x.map((_, i, a) => {
  const w = a.slice(Math.max(0, i - 2), i + 3).sort((p, q) => p - q);
  return w[w.length >> 1];
}));

// 2) 新峰值检测：(x, fs, cfg) => 峰下标数组，然后设 detector: 'myDetector'
//    （记得把名字加到 PARAM_SCHEMA 中 detector 的 options 里）
registerDetector('myDetector', (x, fs, cfg) => { /* ... */ return idx; });

// 3) 新 HRV 特征：(nn 毫秒数组, { tBeat, cfg }) => { 特征名: 值 }
registerFeature('range', (nn) => ({ nnRange: Math.max(...nn) - Math.min(...nn) }));

// 4) 新解读规则 / 机器学习模型（可 async）
registerAnalyzer('stress', async ({ hrv }) => ({
  level: 'info', title: '压力指数', text: `Baevsky SI ≈ ...`,
}));
```

若新特征需要在 HRV 面板中显示，在 `main.js` 的 `HRV_ITEMS` 中加一行即可。

### 离线实验（无需手机）

```js
import { PPGProcessor } from './js/pipeline.js';
import { DEFAULT_CONFIG } from './js/config.js';
const p = new PPGProcessor({ ...DEFAULT_CONFIG, lowCut: 0.7 });
for (const row of csvRows) p.push(row.t, row.R, row.G, row.B); // 导出的 CSV 可直接回放
p.process();
console.log(p.summary().hrv);
```

## 测试

```bash
node tests/run-tests.mjs
```

测试内容：滤波器 −3 dB 截止点与阻带衰减、filtfilt 零相位、周期图 Parseval 能量守恒，以及合成 PPG（带帧抖动、基线漂移、噪声）上的端到端测试。两种检测器的心率误差都小于 0.1 bpm，SDNN 误差小于 1%。

## 课程实验建议

1. 改 `lowCut` / `highCut` / `filterOrder`，观察波形与 HRV 的变化（高通截止过高会削弱重搏波）。
2. 对比 `elgendi` 与 `localMax` 的漏检和误检。
3. 对比 `red` 与 `green` 通道的 PI 和 SQI。
4. 静息 vs 深慢呼吸（6 次/分，0.1 Hz），观察 LF/HF 与功率谱峰的移动。
5. 导出 CSV，与指夹式血氧仪的读数或同步 ECG 做 Bland–Altman 一致性分析。
