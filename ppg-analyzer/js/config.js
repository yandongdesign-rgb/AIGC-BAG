/**
 * 实验参数集中配置（所有可调参数都在这里）
 * ------------------------------------------------------------
 * 修改默认值：直接改 DEFAULT_CONFIG。
 * 运行时修改：页面右上角 “⚙ 参数” 面板会覆盖这里的值，并保存在浏览器 localStorage。
 * 新增参数：在 DEFAULT_CONFIG 中添加，并在 PARAM_SCHEMA 中描述，即可自动出现在参数面板中。
 */

export const DEFAULT_CONFIG = {
  // ---------- 采集 ----------
  channel: 'red',          // 'red' | 'green'：使用的颜色通道（手电筒照射下红光透射最强，绿光对灌注更敏感）
  roiRatio: 0.5,           // 取画面中心多大比例区域求平均（0~1）
  torch: true,             // 是否尝试打开闪光灯（iOS Safari 多数版本不支持，会自动忽略）
  invert: true,            // 透射式 PPG：血容量↑ → 透光↓，取反后收缩期峰向上

  // ---------- 预处理 ----------
  fs: 30,                  // 重采样频率 Hz（摄像头帧间隔抖动，需先插值到均匀采样）
  windowSec: 8,            // 实时分析 / 波形显示窗口长度 s
  warmupSec: 3,            // 开始后丢弃的时长（自动曝光与滤波器稳定）
  detrend: 'linear',       // 'none' | 'mean' | 'linear'

  // ---------- 带通滤波（Butterworth，零相位 filtfilt） ----------
  lowCut: 0.5,             // 高通截止 Hz（≈30 bpm）
  highCut: 4.0,            // 低通截止 Hz（≈240 bpm）
  filterOrder: 4,          // 每一侧的阶数（偶数，由二阶节 biquad 级联实现）
  filter: 'butterworthBandpass', // 滤波器注册名，见 js/dsp/filters.js

  // ---------- 峰值检测 ----------
  detector: 'elgendi',     // 'elgendi'（Elgendi 2013 双滑动平均）| 'localMax'（自适应阈值局部极大值）
  minHR: 40,               // 允许的最低心率 bpm
  maxHR: 180,              // 允许的最高心率 bpm（决定不应期）
  elgendiW1: 0.111,        // Elgendi 峰窗 s
  elgendiW2: 0.667,        // Elgendi 心搏窗 s
  elgendiBeta: 0.02,       // Elgendi 阈值偏移系数 β
  localMaxThreshold: 0.3,  // localMax 阈值 = median + k·(P95 − median)

  // ---------- 间期（PPI）伪迹剔除 ----------
  ibiMaxDeviation: 0.25,   // 与近期中位数偏差超过此比例视为异常间期
  ibiMedianN: 9,           // 近期中位数使用的间期个数

  // ---------- HRV 频域 ----------
  hrvResampleFs: 4,        // 间期序列重采样频率 Hz（Task Force 1996 推荐 4 Hz）
  welchSegSec: 64,         // Welch 分段长度 s（会自动取 2 的整数次幂点数）
  vlfBand: [0.0033, 0.04],
  lfBand: [0.04, 0.15],
  hfBand: [0.15, 0.4],

  // ---------- 信号质量 ----------
  fingerMinRed: 60,        // 红通道均值低于此值视为未放手指
  fingerRedRatio: 1.4,     // R / G 比值低于此值视为未覆盖（画面不够“红”）
  sqiMin: 0.35,            // 频谱 SQI 低于此值时不更新心率
};

/** 参数面板描述：type = number | select | boolean */
export const PARAM_SCHEMA = [
  { group: '采集', key: 'channel', label: '颜色通道', type: 'select', options: ['red', 'green'] },
  { group: '采集', key: 'roiRatio', label: 'ROI 比例', type: 'number', step: 0.1, min: 0.1, max: 1 },
  { group: '采集', key: 'torch', label: '开启闪光灯', type: 'boolean' },
  { group: '采集', key: 'invert', label: '信号取反', type: 'boolean' },
  { group: '预处理', key: 'fs', label: '重采样 fs (Hz)', type: 'number', step: 1, min: 10, max: 60 },
  { group: '预处理', key: 'windowSec', label: '分析窗 (s)', type: 'number', step: 1, min: 4, max: 20 },
  { group: '预处理', key: 'detrend', label: '去趋势', type: 'select', options: ['none', 'mean', 'linear'] },
  { group: '带通滤波', key: 'lowCut', label: '低截止 (Hz)', type: 'number', step: 0.1, min: 0.05, max: 2 },
  { group: '带通滤波', key: 'highCut', label: '高截止 (Hz)', type: 'number', step: 0.1, min: 2, max: 10 },
  { group: '带通滤波', key: 'filterOrder', label: '阶数', type: 'select', options: [2, 4, 6, 8] },
  { group: '峰值检测', key: 'detector', label: '检测算法', type: 'select', options: ['elgendi', 'localMax'] },
  { group: '峰值检测', key: 'maxHR', label: '最高心率', type: 'number', step: 10, min: 100, max: 240 },
  { group: '峰值检测', key: 'elgendiBeta', label: 'Elgendi β', type: 'number', step: 0.01, min: 0, max: 0.5 },
  { group: '峰值检测', key: 'localMaxThreshold', label: 'localMax k', type: 'number', step: 0.05, min: 0, max: 1 },
  { group: '伪迹剔除', key: 'ibiMaxDeviation', label: '最大偏差比', type: 'number', step: 0.05, min: 0.05, max: 1 },
  { group: '信号质量', key: 'sqiMin', label: 'SQI 下限', type: 'number', step: 0.05, min: 0, max: 1 },
];

const STORAGE_KEY = 'ppg-lab-config-v1';

export function loadConfig() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch (_) { /* 隐私模式等 */ }
  return { ...DEFAULT_CONFIG, ...saved };
}

export function saveConfig(cfg) {
  const diff = {};
  for (const k of Object.keys(cfg)) {
    if (JSON.stringify(cfg[k]) !== JSON.stringify(DEFAULT_CONFIG[k])) diff[k] = cfg[k];
  }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(diff)); } catch (_) { /* ignore */ }
}

export function resetConfig() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* ignore */ }
  return { ...DEFAULT_CONFIG };
}
