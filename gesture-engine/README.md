# ETHER · 手势粒子实验室

本地静态网页程序，Three.js GPU 粒子 + MediaPipe Hand Landmarker（21 点、双手）+ Web Audio 合成。无上传摄像头画面。无需 Python、OpenCV、NumPy：本方案在浏览器完成捕捉与推理。

GitHub 版首次启动需要联网下载约 27 MB 的官方模型与 WASM；脚本固定版本并校验 SHA-256，保存在 vendor，之后可离线运行。本地交付目录已包含这些文件。下载失败时修复网络后重新启动即可。也可先运行 `node setup-deps.mjs`。GitHub 不存储这三个大型二进制文件，其他源码、许可证、脚本和实际运行截图均包含在仓库中。

## 启动

1. 安装 Node.js 20 或更新版本（https://nodejs.org）。
2. Windows 双击 `start.cmd`；或在本文件所在目录运行 `node server.mjs`。
3. Chrome / Edge 打开 http://localhost:8731 。不要直接双击 index.html。
4. 初始为鼠标演示模式。点击“开启摄像头”并允许权限；点击“开启合成音效”解锁浏览器音频。

摄像头初始化需数秒。出错会显示原因并退回演示。其他应用占用摄像头时请先关闭它们。停止服务器按 Ctrl+C。远程部署须使用 HTTPS。推荐桌面独立显卡/集显、硬件加速开启。

## 操作与手势

|输入|效果|声音|
|---|---|---|
|张开手掌 / 数字 1|五指光带|空气 sweep|
|握拳 / 2|进入状态时闪爆一次|低频冲击与噪声碎裂|
|仅伸食指 / 3|锯齿分叉电弧并叠加光带|电流噪声与高频音|
|拇指食指捏合 / 4|吸积盘漩涡|低音旋转声场|
|张开手掌上抬 / 5|彩色浮游|混响音垫与四音风铃|
|双手 / 6|双掌间距控制漩涡半径|音高跟随距离|
|无手 / 0|待机星流|淡出至微弱环境声|

上抬使用掌面投影面积与向上速度作为规则近似；普通 RGB 摄像头不能可靠证明掌心朝上。需实际用户校准，当前不宣称已通过六手势真人验收。双手出现时优先进入缩放。左右标签与置信度展示的是 MediaPipe handedness 分类分数，不是单独的手部存在概率；检测、存在与跟踪阈值均在模型配置中设定。

演示模式移动鼠标控制中心、滚轮调半径，自动巡演每 3.5 秒切换。截图 PNG 与十秒 WebM 下载到浏览器默认下载目录，内含输入源、模式、实测 FPS、推理耗时、粒子数。已开启的声音也会录入；录屏不含控制台 UI。随包 screenshot.png 为运行截图，demo.webm 为运行录制，verification.json 为测量记录（如已生成）。

## 参数与性能

修改 config.json 后刷新。particles 控制数量（7000–56000）、最小数、过渡（默认 .45 秒）、像素比。tracking 控制置信阈值、120ms 状态稳定时间、450ms 丢失宽限、归一化捏合距离、上抬速度与推理频率。audio 控制总音量和独立状态音层。gestures 是手势 ↔ 效果 ↔ 声音、标签、配色元数据与基频映射。粒子当前配色由 GPU 渐变和主题控制，color 字段预留给后续主题插件。

粒子随机种子池一次上传，位移、生命周期、衰减与状态混合在 GPU 顶点/片元着色器中完成。拖尾是寿命轨迹流，不存储历史手部路径。爆点使用解析速度与重力；其他模式是解析动画，非物理流体仿真。效果按 .45 秒参数平滑过渡。两秒持续低于 32 FPS 自动降低粒子量，高于 55 FPS 渐进恢复；不保证任意设备达到 30 FPS。推理在 Worker 中串行限频，不积压帧。ms 指模型调用耗时，不是完整摄像头到显示延迟。

## 扩展接口

- `src/gestures.js`：纯函数 classify(landmarks, previousPalm, dt, config) 返回状态字符串，可替换成模型分类器；Stabilizer 独立管理防抖。双手逻辑在 app.js 的 processHands 中。
- `src/particles.js`：ParticleField 接口 setMode(effect)、draw(time, dt, center, tips, scale)。新模式可在 shader 增加位置函数、权重及 setMode 映射；也可用保持相同接口的渲染插件替换此类。新粒子模式不是无代码热加载。
- `src/audio.js`：SoundField 接口 start/toggle/volume/update。新音色在此添加，音层按 config 中的状态自动建立。sound 字段为语义映射；当前瞬态处理按状态分发，新增 sound 需扩展 update 分发。
- `src/app.js`：输入、状态、视觉、音效编排。window.etherMetrics 可读取运行状态。避免直接把演示 FPS 当摄像头性能。

## 验证

`node --test tests/*.test.mjs` 验证规则几何、上抬与防抖。真人验收：分别保持每种姿势约一秒，测试横竖方向、左右手、距离与不同光照；连续切换、遮挡后恢复、双手拉开；开启录制并检查画面、状态、听感与 FPS。完整端到端延迟需用高速摄像拍摄动作和屏幕后逐帧统计，目前未测。

## 依赖与来源

Three.js 0.170.0（MIT），MediaPipe Tasks Vision 0.10.22-rc.20250304（Apache-2.0）与官方 hand_landmarker float16 v1 模型，均位于 vendor；保留原始文件中的版权声明，完整许可证见 vendor。模型由 Google 官方地址获取。API 参考：https://developers.google.com/edge/api/mediapipe/js/tasks-vision.handlandmarker ；https://threejs.org/docs/pages/ShaderMaterial.html 。

