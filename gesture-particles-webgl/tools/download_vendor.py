"""
把 MediaPipe 依赖下载到 ./vendor，实现完全离线运行（展会/无网环境）。
用法：python tools/download_vendor.py
下载完成后无需改配置：程序启动时检测到 vendor/hand_landmarker.task 会自动改用本地文件。
"""
import os, urllib.request, sys

VER = "0.10.14"
BASE = f"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@{VER}"
FILES = {
    f"{BASE}/vision_bundle.mjs": "vendor/tasks-vision/vision_bundle.mjs",
    f"{BASE}/wasm/vision_wasm_internal.js": "vendor/tasks-vision/wasm/vision_wasm_internal.js",
    f"{BASE}/wasm/vision_wasm_internal.wasm": "vendor/tasks-vision/wasm/vision_wasm_internal.wasm",
    f"{BASE}/wasm/vision_wasm_nosimd_internal.js": "vendor/tasks-vision/wasm/vision_wasm_nosimd_internal.js",
    f"{BASE}/wasm/vision_wasm_nosimd_internal.wasm": "vendor/tasks-vision/wasm/vision_wasm_nosimd_internal.wasm",
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task": "vendor/hand_landmarker.task",
}

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for url, rel in FILES.items():
    dst = os.path.join(root, rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    print("下载", url)
    try:
        urllib.request.urlretrieve(url, dst)
        print("  →", rel, os.path.getsize(dst) // 1024, "KB")
    except Exception as e:
        print("  ✘ 失败：", e)
        sys.exit(1)
print("完成。刷新页面即可离线使用。")
