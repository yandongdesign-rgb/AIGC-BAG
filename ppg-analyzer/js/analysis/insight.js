/**
 * 智能解读模块（规则引擎，可替换为机器学习模型）
 * ------------------------------------------------------------
 * 每个分析器签名：(ctx) => { level: 'ok'|'warn'|'info', title, text } | null
 * ctx = { hrv, live, cfg }，hrv 为 PPGProcessor.summary().hrv
 *
 * 拓展示例（接入 TensorFlow.js 模型）：
 *   registerAnalyzer('myModel', async ({ hrv }) => {
 *     const y = model.predict(tf.tensor([[hrv.meanNN, hrv.sdnn, hrv.rmssd]]));
 *     return { level: 'info', title: '模型输出', text: `压力评分 ${y.dataSync()[0].toFixed(2)}` };
 *   });
 *
 * 注意：以下参考范围来自健康成人的文献值，仅用于教学演示，不能作为诊断依据。
 */

export const ANALYZERS = {
  quality({ hrv }) {
    if (!hrv.n) return null;
    const r = hrv.artifactRate * 100;
    if (r > 20) return { level: 'warn', title: '信号质量较差', text: `${r.toFixed(0)}% 的间期被判为伪迹，建议保持手指静止、轻压、重新测量。` };
    if (r > 5) return { level: 'info', title: '信号质量一般', text: `伪迹间期占 ${r.toFixed(0)}%，结果可参考但 HRV 指标误差会增大。` };
    return { level: 'ok', title: '信号质量良好', text: `伪迹间期占 ${r.toFixed(1)}%。` };
  },

  heartRate({ hrv }) {
    if (!Number.isFinite(hrv.meanHR)) return null;
    const hr = hrv.meanHR;
    if (hr < 60) return { level: 'info', title: '心率偏低', text: `平均脉率 ${hr.toFixed(0)} bpm，低于成人静息参考范围 60–100 bpm（运动员常见）。` };
    if (hr > 100) return { level: 'warn', title: '心率偏高', text: `平均脉率 ${hr.toFixed(0)} bpm，高于 60–100 bpm 参考范围，可能与活动、紧张、咖啡因有关，请静坐 5 分钟后复测。` };
    return { level: 'ok', title: '心率在参考范围', text: `平均脉率 ${hr.toFixed(0)} bpm（参考 60–100 bpm）。` };
  },

  rhythm({ hrv }) {
    if (!(hrv.n >= 20)) return null;
    // 呼吸性窦性心律不齐会使 CV 达到 5–10%，阈值取较宽松值
    if (hrv.cvnn > 15 && hrv.sd1sd2 > 0.8) {
      return { level: 'warn', title: '节律不规则提示', text: `间期变异系数 ${hrv.cvnn.toFixed(1)}%，SD1/SD2=${hrv.sd1sd2.toFixed(2)}，Poincaré 图呈弥散分布。多数情况下由运动伪迹引起；如反复出现建议做心电图检查。` };
    }
    return { level: 'ok', title: '节律规整', text: `间期变异系数 ${hrv.cvnn.toFixed(1)}%。` };
  },

  autonomic({ hrv }) {
    if (!Number.isFinite(hrv.rmssd)) return null;
    let text = `RMSSD ${hrv.rmssd.toFixed(1)} ms、SDNN ${hrv.sdnn.toFixed(1)} ms（短时记录，健康青年常见 RMSSD 约 20–90 ms）。`;
    if (hrv.durationOk && Number.isFinite(hrv.lfhf)) {
      text += ` LF/HF = ${hrv.lfhf.toFixed(2)}，`;
      text += hrv.lfhf > 2 ? '交感成分相对占优（紧张、清醒活动状态常见）。' : hrv.lfhf < 0.5 ? '迷走（副交感）成分相对占优（放松、慢呼吸时常见）。' : '交感/迷走成分较均衡。';
    } else {
      text += ' 频域指标需连续记录 ≥ 2 分钟才可靠。';
    }
    return { level: 'info', title: '自主神经活动', text };
  },
};

export function registerAnalyzer(name, fn) {
  ANALYZERS[name] = fn;
}

export async function runAnalyzers(ctx) {
  const out = [];
  for (const [name, fn] of Object.entries(ANALYZERS)) {
    try {
      const r = await fn(ctx);
      if (r) out.push({ name, ...r });
    } catch (e) { console.warn('analyzer', name, e); }
  }
  return out;
}
