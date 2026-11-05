#!/usr/bin/env bash
# 环境自检：Codex / ffmpeg / Python / ARK_API_KEY / 网络。不打印任何密钥。
ok(){ echo "  [OK]  $*"; }; bad(){ echo "  [缺]  $*"; }
echo "== 本地工具 =="
command -v ffmpeg >/dev/null && ok "ffmpeg $(ffmpeg -version | head -1 | awk '{print $3}')" || bad "ffmpeg"
command -v python3 >/dev/null && ok "Python $(python3 -V | awk '{print $2}')" || bad "Python"
python3 -c "import PIL,numpy" 2>/dev/null && ok "Pillow + numpy" || bad "Pillow/numpy"
command -v codex >/dev/null && ok "codex $(codex --version 2>/dev/null)" || bad "codex CLI 未安装"
[ -f ~/.codex/auth.json ] && ok "codex 已登录" || bad "codex 未登录 (~/.codex/auth.json 不存在)"
echo "== 密钥 =="
[ -n "$ARK_API_KEY" ] && ok "ARK_API_KEY 已设置（长度 ${#ARK_API_KEY}）" || bad "ARK_API_KEY 未设置"
echo "== 网络 =="
for h in ark.cn-beijing.volces.com api.openai.com chatgpt.com; do
  c=$(curl -s -o /dev/null -m 10 -w "%{http_code}" https://$h/ 2>/dev/null)
  [ "$c" != "000" ] && ok "$h 可达 (HTTP $c)" || bad "$h 不可达（被环境网络策略拦截）"
done
