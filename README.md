# AIGC-BAG

AI 创意工具、交互实验与浏览器作品集合。各项目独立运行；根目录的 npm 命令仅用于图片工具，并非所有项目的统一启动入口。

## 项目导航

| 分类 | 项目 | 说明与入口 |
| --- | --- | --- |
| AI 图片工具 | Grid Splitter & AI Enhancer | 根目录 React / Vite 应用；网格图片切分及 Gemini 图片增强 |
| 手势交互 | [gesture-engine](gesture-engine/README.md) | 手势交互引擎；含启动脚本和单元测试 |
| 手势交互 | [gesture-garden](gesture-garden/README.md) | 手势花园实验 |
| 手势交互 | [gesture-particle-engine](gesture-particle-engine/README.md) | 手势识别、粒子交互与音效 |
| 浏览器游戏 | [reef-fishing](reef-fishing/README.md) | 钓鱼游戏 |
| 浏览器游戏 | [sword-runner](sword-runner/index.html) | 浏览器游戏；入口为 index.html |
| 浏览器游戏 | [windwalker-game](windwalker-game/README.md) | 浏览器游戏 |
| 动态视觉 | [waterfall-wallpaper](waterfall-wallpaper/README.md) | 瀑布壁纸与预览素材 |
| 音频工具 | [woodsonic](woodsonic/README.md) | 复古录音、回放与网络电台 |
| 音频工具 | [woodsound](woodsound/README.txt) | 录音与网络电台的独立实现 |
| Codex 技能 | [daily-world-news](skills/daily-world-news/SKILL.md) | 国际新闻整理技能 |

上表链接指向源码或说明；HTML 文件需要在本地服务器或已配置的静态托管服务中打开。

## 启动根目录图片工具

需要 Node.js 与 npm；Node.js 22 可作为开发环境起点，完整浏览器兼容性仍需实测。

```sh
npm install
```

复制 [.env.example](.env.example) 为 `.env.local`，填写自己的 Gemini API key，然后运行：

```sh
npm run dev
```

默认地址：`http://localhost:3000`。

```sh
npm run build
npm run preview
```

原始 AI Studio 项目：[Grid Splitter & AI Enhancer](https://ai.studio/apps/drive/1IfuHTVSCR_N_24nvoxO-Bw8ACxdDfuVh)。

**密钥使用边界：** 当前 Vite 配置会将 Gemini key 注入前端构建，浏览器使用者可以获取它。此运行方式适合个人本地实验；公开部署前应将模型调用迁移到服务端，并配置认证与额度限制。`.env.local` 不应提交。

## 运行其他项目

- 带独立 README 的项目优先遵循其说明，尤其是手势项目的模型、WASM 和第三方依赖准备步骤。
- `gesture-engine`：进入目录后执行 `npm start`；测试命令为 `npm test`。
- `gesture-particle-engine`：进入目录后执行 `npm start`。
- 静态 HTML 项目：可在安装 Python 3 后，于仓库根目录执行 `python -m http.server 8000`，再打开 `http://localhost:8000/<项目目录>/`。
- 摄像头和麦克风通常需要 localhost 或 HTTPS、安全上下文及用户授权。
- 网络电台和 CDN 依赖由第三方维护；项目现有 README 中的限制与未验证项仍然适用。

## 目录与维护

根目录 `App.tsx`、`index.tsx`、`services/`、`utils/` 和相关配置属于图片工具；其他作品保持独立目录。

- [仓库结构与整理记录](docs/REPOSITORY_STRUCTURE.md)
- [贡献和验证规范](CONTRIBUTING.md)

本仓库尚未提供覆盖全部自有代码的根级 LICENSE。第三方文件保留各自许可；子项目 package.json 中的许可字段不代表整个仓库已统一授权。
