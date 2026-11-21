# 仓库结构与整理记录

## 当前结构

| 路径 | 职责 |
| --- | --- |
| App.tsx、index.tsx、index.html、types.ts | 根目录图片工具的界面、入口与类型 |
| services/、utils/ | 图片工具的模型调用与图片处理 |
| package.json、tsconfig.json、vite.config.ts、metadata.json | 图片工具的依赖、编译及应用配置 |
| gesture-engine/、gesture-garden/、gesture-particle-engine/ | 三个独立手势实验 |
| reef-fishing/、sword-runner/、windwalker-game/ | 独立浏览器游戏 |
| waterfall-wallpaper/ | 动态视觉作品及媒体资源 |
| woodsonic/、woodsound/ | 两个独立音频工具 |
| skills/ | Codex 技能 |
| docs/ | 仓库级维护说明 |

## 本次整理

- 将根 README 从 AI Studio 默认模板改为分类导航与运行说明。
- 补充环境变量示例、贡献规范及 PR 模板。
- 补充忽略规则，避免误提交常见环境文件与系统临时文件。
- 保留所有现有应用位置、源码、素材及第三方许可证。

## 后续需要单独验证的事项

1. **同主题项目的关系**：gesture 系列以及 woodsonic / woodsound 目前按独立实现保留，尚未判断合并或淘汰关系。
2. **依赖可复现性**：根目录未见锁文件；需要在可安装依赖并完成构建的环境中生成、验证并提交锁文件。
3. **许可范围**：根目录未见统一 LICENSE；gesture-particle-engine 的 package.json 声明 MIT，但不能据此推定整个仓库的授权。
4. **第三方资源**：检查模型、WASM、CDN、网络电台及媒体的完整性、可用性与许可。
5. **目录迁移**：若以后统一迁入 apps/ 或 experiments/，应先盘点部署入口、外部链接与相对资源路径，并提供旧入口兼容方案。
6. **自动化检查**：先验证每个项目实际可运行的构建和测试命令，再建立按项目触发的 CI。

以上是待办事项，不代表已完成构建、安全审计或真实设备验收。
