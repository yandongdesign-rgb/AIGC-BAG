import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { MAX_PARTICLES } from './engine.js';
import { StripBatch } from './stripBatch.js';

const HSL = /* glsl */ `
vec3 hsl2rgb(float h, float s, float l) {
  vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return l + s * (rgb - 0.5) * (1.0 - abs(2.0 * l - 1.0));
}`;

const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

/** three.js 渲染层：正交相机 2D 场景（屏幕高 = 2），GPU 点精灵粒子 + 条带 + 摄像头背景 + 辉光后处理 */
export class FxRenderer {
  constructor(canvas, cfg) {
    this.cfg = cfg;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
    this.videoAspect = null;
    this.batch = new StripBatch();

    // 摄像头背景
    this.videoMat = new THREE.MeshBasicMaterial({ color: 0x555555, toneMapped: false });
    this.videoMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.videoMat);
    this.videoMesh.visible = false;
    this.videoMesh.position.z = -5;
    this.scene.add(this.videoMesh);

    // 粒子
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.dataAttr = new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('aData', this.dataAttr);
    this.uniforms = { uPR: { value: 1 }, uHueShift: { value: 0 }, uSat: { value: 1 } };
    const add = { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, depthTest: false, depthWrite: false, transparent: true };
    this.points = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        ...add,
        uniforms: this.uniforms,
        vertexShader: /* glsl */ `
          attribute vec4 aData;
          uniform float uPR; uniform float uHueShift; uniform float uSat;
          varying vec4 vCol;
          ${HSL}
          void main() {
            if (aData.z <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy, 0.0, 1.0);
            gl_PointSize = aData.z * uPR;
            vec3 c = hsl2rgb(fract((aData.x + uHueShift) / 360.0), 0.9 * uSat, 0.55);
            vCol = vec4(mix(c, vec3(1.0), clamp(aData.w, 0.0, 1.0)), aData.y);
          }`,
        fragmentShader: /* glsl */ `
          varying vec4 vCol;
          void main() {
            float d = length(gl_PointCoord - 0.5) * 2.0;
            if (d > 1.0) discard;
            float a = pow(1.0 - d, 1.8) + smoothstep(0.3, 0.0, d) * 0.5;
            gl_FragColor = vec4(vCol.rgb * vCol.a * a, 1.0);
          }`,
      }),
    );
    this.points.frustumCulled = false;
    this.scene.add(this.points);

    // 光带 / 电弧
    const sg = new THREE.BufferGeometry();
    this.stripPos = new THREE.BufferAttribute(this.batch.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.stripCol = new THREE.BufferAttribute(this.batch.col, 4).setUsage(THREE.DynamicDrawUsage);
    sg.setAttribute('position', this.stripPos);
    sg.setAttribute('aColor', this.stripCol);
    this.strips = new THREE.Mesh(
      sg,
      new THREE.ShaderMaterial({
        ...add,
        side: THREE.DoubleSide,
        vertexShader: `attribute vec4 aColor; varying vec4 vC; void main(){ vC = aColor; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `varying vec4 vC; void main(){ gl_FragColor = vec4(vC.rgb * vC.a, 1.0); }`,
      }),
    );
    this.strips.frustumCulled = false;
    this.scene.add(this.strips);

    // 手部骨架（调试）
    const kg = new THREE.BufferGeometry();
    this.bonePos = new THREE.BufferAttribute(new Float32Array(2 * BONES.length * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage);
    kg.setAttribute('position', this.bonePos);
    this.skeleton = new THREE.LineSegments(kg, new THREE.LineBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.45 }));
    this.skeleton.frustumCulled = false;
    this.skeleton.visible = false;
    this.scene.add(this.skeleton);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), cfg.bloom.strength, cfg.bloom.radius, cfg.bloom.threshold);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.quality = cfg.quality.levels[cfg.quality.start];
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  get aspect() {
    return this.width / this.height;
  }

  resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio);
    this.pixelRatio = pr;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(this.width, this.height, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(this.width, this.height);
    const s = this.quality.bloomScale;
    this.bloom.resolution.set(this.width * s, this.height * s);
    this.bloom.setSize(this.width * pr * s, this.height * pr * s);
    const a = this.aspect;
    Object.assign(this.camera, { left: -a, right: a, top: 1, bottom: -1 });
    this.camera.updateProjectionMatrix();
    this.uniforms.uPR.value = pr;
    this._layoutVideo();
  }

  setQuality(level) {
    this.quality = level;
    this.resize();
  }

  setTheme(theme) {
    this.theme = theme;
    this.renderer.setClearColor(new THREE.Color(theme.background), 1);
    this.uniforms.uHueShift.value = theme.hueShift;
    this.uniforms.uSat.value = theme.saturation;
    this.batch.hueShift = theme.hueShift;
    this.batch.sat = theme.saturation;
    this.videoMat.color.setScalar(theme.video);
  }

  setVideo(video) {
    const tex = new THREE.VideoTexture(video);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.videoMat.map = tex;
    this.videoMat.needsUpdate = true;
    this.videoAspect = video.videoWidth / video.videoHeight;
    this.videoMesh.visible = true;
    this._layoutVideo();
  }

  /** 摄像头画面按 cover 方式铺满，并水平镜像 */
  _layoutVideo() {
    const a = this.aspect;
    const va = this.videoAspect || a;
    this.vw = va > a ? 2 * va : 2 * a;
    this.vh = va > a ? 2 : (2 * a) / va;
    this.videoMesh.scale.set(-this.vw, this.vh, 1);
  }

  /** 原始帧归一化坐标 → 世界坐标（含镜像） */
  toWorld(p) {
    return { x: (0.5 - p.x) * this.vw, y: (0.5 - p.y) * this.vh };
  }

  setSkeleton(hands, visible) {
    this.skeleton.visible = visible && hands.length > 0;
    if (!this.skeleton.visible) return;
    const arr = this.bonePos.array;
    arr.fill(0);
    let k = 0;
    for (const h of hands.slice(0, 2)) {
      for (const [a, b] of BONES) {
        const A = this.toWorld(h.landmarks[a]);
        const B = this.toWorld(h.landmarks[b]);
        arr.set([A.x, A.y, 0, B.x, B.y, 0], k);
        k += 6;
      }
    }
    this.bonePos.needsUpdate = true;
  }

  render(engine) {
    this.posAttr.array.set(engine.aPos);
    this.dataAttr.array.set(engine.aData);
    this.posAttr.needsUpdate = true;
    this.dataAttr.needsUpdate = true;
    this.batch.begin();
    engine.drawStrips(this.batch);
    this.strips.geometry.setDrawRange(0, this.batch.n);
    this.stripPos.needsUpdate = true;
    this.stripCol.needsUpdate = true;
    this.stripPos.clearUpdateRanges?.();
    this.stripPos.addUpdateRange?.(0, this.batch.n * 3);
    this.stripCol.clearUpdateRanges?.();
    this.stripCol.addUpdateRange?.(0, this.batch.n * 4);
    if (this.quality.bloom) {
      this.bloom.strength = this.cfg.bloom.strength + engine.flash;
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }
}
