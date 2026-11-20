# 手势交互粒子引擎（Gesture Particle Engine）

摄像头实时手势识别 + GPU 点精灵粒子动效 + Web Audio 合成音效的网页程序。所有画面与声音都在**本地浏览器**处理，不上传任何数据。

---

## 一、环境依赖

| 项目 | 要求 | 说明 |
| --- | --- | --- |
| Node.js | ≥ 14（可选） | 仅用于启动零依赖静态服务器；也可用 VS Code Live Server / Python `python -m http.server` |
| 浏览器 | Chrome / Edge 最新版 | 需支持 WebGL、Web Audio、MediaRecorder；摄像头 API 要求 `localhost` 或 HTTPS |
| 网络 | 首次运行需联网 | 从 jsDelivr CDN 加载 MediaPipe Hands（约几 MB），之后浏览器会缓存 |
| 摄像头 | 可选 | 无摄像头时可用「演示模式」查看全部特效 |

**本项目无 npm 安装步骤**，无需 `npm install`，源码即开即用。

---

## 二、启动

```bash
cd particle-gesture-engine
node server.js
```

浏览器打开 <http://localhost:8080>。

- 点击「启动摄像头」并授权 → 实时手势控制。
- 点击「演示模式」→ 无摄像头也能自动轮播 7 种状态（便于演示 / 截图 / 录屏）。
- 快捷链接：<http://localhost:8080/?demo=1&autostart=1> 直接进入演示模式。

> 若用其他静态服务器，请把根目录设为本项目目录，且保持 `config/` 与 `js/` 同级。

---

## 三、手势说明与映射

| 手势 | 判定依据 | 粒子状态 | 音效 |
| --- | --- | --- | --- |
| 手掌张开 | 四指以上伸直、拇指张开 | 拖尾：指尖牵引彩色光带，辉光渐变衰减 | 流动空气嗡鸣 + sweep |
| 握拳 | 伸直手指数 ≤ 1 且拇指收拢；握紧瞬间触发 | 闪爆：拳心向外冲击爆炸 + 火花碎片 | 低频冲击爆响 + 碎裂高频 |
| 食指指向 | 仅食指伸直 | 闪电：指尖向前锯齿电弧，随机分叉 | 噼啪电流 + 高压嘶鸣 |
| 拇指食指捏合 | 两指尖距离 / 掌宽 < 阈值 | 漩涡：绕捏合点高速旋转的吸积盘，跟随移动 | 旋转上升音 + 吸入低音 |
| 摊平上抬 | 张开手 + 持续向上速度超阈值 | 四散飞舞：彩色粒子弱重力缓慢飘散 | 空灵 pad + 细碎风铃 |
| 双手靠近 / 拉开 | 双手掌心间距 | 漩涡 / 爆点半径随距离缩放 | 音高随距离滑动 |
| 无手 / 丢失 | 无手或置信度 < 阈值 | 待机背景粒子流 | 环境底噪，静默过渡 |

判定使用 21 个关键点的**关节角度 + 归一化距离**（按掌宽归一化，远近手都稳定），带 110ms 防抖、捏合滞回与上抬速度窗口。状态切换时特效权重在 0.3–0.6s 内指数插值，支持多特效叠加。

---

## 四、参数配置（无需改代码）

| 文件 | 作用 |
| --- | --- |
| `config/mapping.json` | 手势 ↔ 特效 ↔ 音效映射、状态优先级、音效层增益与冷却 |
| `config/particles.json` | 粒子池容量、每种模式的发射率/寿命/速度/尺寸/阻尼/重力/色相、降级阈值、配色主题 |
| `config/recognition.json` | 手势判定阈值、置信度、平滑系数、上抬速度、MediaPipe 复杂度 |

修改后点击控制台「重载配置」，或在浏览器控制台执行：

```js
await reloadConfig()
```

常用调参：

- 粒子太少/卡顿 → `particles.json → global.capacity`、`minFps`、`targetFps`，或面板「粒子密度」。
- 拖影长短 → `global.fadeAlpha`（越小拖影越长）。
- 手势过于灵敏/迟钝 → `recognition.json → pinchRatio`、`fingerExtendedAngle`、`liftVelocity`、`stateHoldMs`。
- 主题色 → `particles.json → themes` 与面板「配色主题」。

---

## 五、扩展接口

1. **新手势**：在 `config/mapping.json` 的 `gestures` 追加一项，并在 `config/recognition.json` 调整阈值；若需复杂判定，实现 `classify(hands, metrics) → {state, confidence}` 的类，把 URL 写入 `recognition.customClassifierUrl`，引擎会自动动态导入并覆盖规则结果（`js/gesture-classifier.js`）。
2. **新粒子模式**：在 `config/particles.json → modes` 增加模式参数，在 `js/particle-engine.js → update()` 增加对应发射分支，并在映射表的 `effects` 中引用；渲染器无需改动（统一读取 8 float 顶点缓冲）。
3. **新音效**：在 `config/mapping.json → audioLayers / soundTriggers` 增加定义，在 `js/audio-engine.js` 的 `_buildLayers()` 或 `trigger()` 中增加合成实现。
4. **新渲染器**：实现 `resize / beginFrame / draw / dispose` 四方法即可替换（见 `js/renderers.js`）。

---

## 六、性能与画质

- 默认粒子池 6000，起始预算 3200；WebGL 点精灵单次 draw call 批量渲染，Canvas2D 为自动降级路径。
- 持续低于 30fps 时自动降低发射量（最低 35%），高于 45fps 时缓慢恢复；面板实时显示画质百分比。
- 状态过渡使用与帧率无关的指数插值，掉帧也不会跳变。
- 音效链路：各层 → 主增益 → DynamicsCompressor（压缩限幅）→ 0.92 限幅 → 输出，避免爆音削波。

---

## 七、录制

点击控制台「● 录制 WebM」即可把当前粒子画面（左上角叠加 FPS / 粒子数 / 延迟）连同音效录成 `.webm` 文件并自动下载。演示模式配合录制可产出可复现的演示视频。

---

## 八、目录结构

```
particle-gesture-engine/
├── index.html                # 页面入口
├── server.js                 # 零依赖静态服务器
├── package.json
├── README.md
├── css/style.css
├── config/
│   ├── mapping.json          # 手势↔特效↔音效
│   ├── particles.json        # 粒子参数表
│   └── recognition.json      # 识别阈值
├── js/
│   ├── config.js             # 配置加载 / 热重载
│   ├── utils.js
│   ├── hand-tracker.js       # MediaPipe / Demo 数据源
│   ├── gesture-classifier.js # 手势分类 / 可插拔模型接口
│   ├── particle-engine.js    # 粒子池 / 发射器 / 过渡 / 降级
│   ├── renderers.js          # WebGL + Canvas2D
│   ├── audio-engine.js       # Web Audio 合成
│   └── main.js               # 主循环 / UI / 录制
└── docs/                     # 运行截图与录屏
```

---

## 九、常见问题

- **摄像头没画面**：确认用 `localhost` 打开（不是 `file://`），浏览器已授权，且 MediaPipe CDN 可访问；可先看演示模式确认程序正常。
- **没有声音**：浏览器要求用户手势后才能播放音频，请先点击「启动摄像头」或「演示模式」按钮。
- **画面很暗/拖影长**：调大 `global.fadeAlpha`，或切换虚空黑主题的浅色变体。
- **想隐藏摄像头**：面板取消勾选「显示摄像头」，或点预览窗右上角 ×，只保留粒子层。
