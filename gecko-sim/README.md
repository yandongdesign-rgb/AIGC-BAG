# Gekko GX-4 · 机械壁虎模拟器

参照「Pelagos OC-8 机械章鱼」演示视频的风格，改成**机械壁虎**的程序化 3D 交互模拟器：浅色实验室 HUD、橙白陶瓷外壳，镜头按时间线自动切换，各部件可以展开、分解。

## 直接使用

> ⚠️ 在 GitHub 网页上点开 `.html` 只会看到源代码，或者只有界面没有壁虎。GitHub 不会运行页面里的脚本，微信和手机的文件预览也不会。
> 请点 GitHub 的 **Download raw file** 把文件下载到电脑，再用 Chrome / Edge / Safari 打开。

双击打开 **`Gekko-GX4-Simulator.html`** 即可，Chrome、Edge、Safari、Firefox 都能用。

- 单个文件，three.js 已内联，**离线可用**，不用安装，也不用起服务器。
- `preview.mp4`：35 秒录屏预览。

## 时间线（35 秒循环）

| 时间 | 模式 | 内容 |
|---|---|---|
| 00:00 | SCUTTLING 疾行 | 对角小跑步态，脊柱摆动，尾巴摆动，脚趾抬起时向上翻卷 |
| 00:04 | CLINGING 吸附静止 | 20 个趾垫全部着地，进入呼吸待机 |
| 00:08 | OPTICS OPEN 光学展开 | 眼睑张开，竖瞳光学阵列外推，下颌张开 |
| 00:12 | DORSAL OPEN 背甲开启 | 6 片背甲翻开，露出反应环、线圈和齿轮 |
| 00:16 | LIMB FR APART 右前肢分解 | 右前肢沿关节链逐级分开 |
| 00:20 | TAIL DROP 断尾自切 | 尾巴在第 06 节断开，断下的部分扭动 |
| 00:24 | TEARDOWN 整机爆炸视图 | 所有部件按层级向外展开 |
| 00:28 | HOLDING 复位保持 | 部件复位，转台旋转 |
| 00:31 | DEPARTING 离场 | 加速冲刺离开画面 |

## 交互

- **拖拽**旋转视角，**滚轮**缩放，**双击**复位视角
- **空格**暂停/播放，**← →**切换上一个/下一个模式
- 点击底部 OPERATION LOG 的进度条可以跳到任意时刻
- **ASSEMBLIES**：直接跳到对应部件的展示段（HERO / OPTICS / DORSAL / LIMB FR / TAIL / GAIT）
- **DISPLAY**：LABELS 标注、EXPLODED 常驻爆炸视图、GRID 地面网格、TURNTABLE 转台

## 修改与重新构建

- 源码：`src/gecko.html`，模型、动画和 HUD 都在这一个文件里。
- 改完后运行 `node build.mjs`，会把 `vendor/three.min.js`（r149）内联进去，重新生成 `Gekko-GX4-Simulator.html`。
- 录制模式：在地址后加 `?capture`，然后在控制台调用 `SIM.advance(1/30)` 逐帧推进，方便导出视频。
