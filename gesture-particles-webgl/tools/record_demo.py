"""
录屏 / 截图工具：用 Playwright 打开自动演示模式（?demo=1），按时间点截图并录制视频，
同时把每个阶段的 FPS / 帧耗时 / 粒子数写入 output/metrics.json。

用法：
    pip install playwright && playwright install chromium
    python -m http.server 8000          # 另开一个终端，在项目根目录运行
    python tools/record_demo.py [--url http://localhost:8000] [--headed] [--chrome /path/to/chrome]

说明：无头模式下 WebGL 走软件渲染（SwiftShader），帧率远低于真机，仅供功能验证；
真机帧率请用 --headed 在有显卡的电脑上跑。
"""
import argparse, json, os, shutil, time
from playwright.sync_api import sync_playwright

# 演示脚本时间轴（秒）→ 截图名（对应 src/input/simulator.js 的 script）
SHOTS = [
    (2.5, "01_open_palm_trail"),
    (5.75, "02_fist_burst"),
    (10.5, "03_point_lightning"),
    (15.0, "04_pinch_vortex"),
    (19.5, "05_palm_up_scatter"),
    (22.5, "06_dual_vortex_scale"),
    (26.5, "07_point_open_overlay"),
    (29.4, "08_idle_fallback"),
    (32.4, "09_plugin_victory_ripple"),
]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:8000")
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--chrome", default=None)
    ap.add_argument("--out", default="output")
    ap.add_argument("--size", default="1280x720")
    ap.add_argument("--query", default="", help="附加 URL 参数，如 quality=0 固定最高画质")
    a = ap.parse_args()
    w, h = map(int, a.size.split("x"))
    os.makedirs(a.out, exist_ok=True)
    vid_dir = os.path.join(a.out, "_video")
    args = ["--autoplay-policy=no-user-gesture-required", "--ignore-gpu-blocklist"]
    if not a.headed:
        args += ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
    with sync_playwright() as p:
        b = p.chromium.launch(headless=not a.headed, executable_path=a.chrome, args=args)
        c = b.new_context(viewport={"width": w, "height": h}, record_video_dir=vid_dir, record_video_size={"width": w, "height": h})
        pg = c.new_page()
        errors = []
        pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errors.append(str(e)))
        q = ("&" + a.query) if a.query else ""
        # 第 1 遍：完整录制一轮演示（34 秒）
        pg.goto(a.url + "/?demo=1" + q, wait_until="load")
        t0 = time.time()
        while (pg.evaluate("window.__demoT || 0") or 0) < 1 and time.time() - t0 < 30:
            time.sleep(0.1)
        f0, s0 = pg.evaluate("[window.__stats.frames, performance.now()]")
        while (pg.evaluate("window.__demoT || 0") or 0) < 34 and time.time() - t0 < 150:
            time.sleep(0.25)
        f1, s1 = pg.evaluate("[window.__stats.frames, performance.now()]")
        avg_fps = (f1 - f0) / ((s1 - s0) / 1000)
        print(f"整轮演示平均帧率（录屏中）: {avg_fps:.1f} fps")
        video = pg.video.path()
        c.close()
        # 第 2 遍：每张截图单独从目标时间前 2.5 秒开始，避免低帧率下截图滞后错位
        c2 = b.new_context(viewport={"width": w, "height": h})
        metrics = []
        for t, name in SHOTS:
            pg = c2.new_page()
            pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.goto(a.url + f"/?demo=1&demoStart={max(0, t - 2.5)}" + q, wait_until="load")
            while (pg.evaluate("window.__demoT || 0") or 0) < t:
                time.sleep(0.02)
            pg.screenshot(path=os.path.join(a.out, name + ".png"))
            s = pg.evaluate("({...window.__stats})")
            s["shot"] = name; s["t"] = t
            metrics.append(s)
            print(f"{name:32s} fps={s['fps']:.1f} frame={s['frameMs']:.1f}ms particles={s['particles']} quality={s['quality']}")
            pg.close()
        c2.close(); b.close()
    shutil.move(video, os.path.join(a.out, "demo_recording.webm"))
    shutil.rmtree(vid_dir, ignore_errors=True)
    json.dump({"loop_avg_fps_while_recording": round(avg_fps, 1), "metrics": metrics, "errors": errors, "mode": "headed" if a.headed else "headless-swiftshader", "query": a.query},
              open(os.path.join(a.out, "metrics.json"), "w"), ensure_ascii=False, indent=2)
    print("errors:", errors or "none")

if __name__ == "__main__":
    main()
