/** 截图 / 录屏：把 WebGL 画面与帧率、延迟标注合成到一张 2D 画布 */
export class Recorder {
  constructor(canvas, getLines) {
    this.src = canvas;
    this.getLines = getLines;
    this.out = document.createElement('canvas');
    this.ctx = this.out.getContext('2d');
    this.active = false;
  }

  compose() {
    const { src, out, ctx } = this;
    if (out.width !== src.width || out.height !== src.height) {
      out.width = src.width;
      out.height = src.height;
    }
    ctx.drawImage(src, 0, 0);
    const s = out.height / 720;
    const lines = this.getLines();
    ctx.font = `${Math.round(15 * s)}px ui-monospace, Menlo, Consolas, monospace`;
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width), 0) + 24 * s;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(10 * s, out.height - (16 + lines.length * 22) * s, w, (lines.length * 22 + 8) * s);
    ctx.fillStyle = '#7cf3c8';
    lines.forEach((l, i) => ctx.fillText(l, 22 * s, out.height - (16 + (lines.length - i - 1) * 22) * s - 8 * s));
  }

  tick() {
    if (this.active) this.compose();
  }

  screenshot() {
    this.compose();
    this.out.toBlob((b) => download(b, `gesture-particles-${Date.now()}.png`));
  }

  record(seconds = 10, audioStream, { save = true } = {}) {
    return new Promise((resolve) => {
      this.active = true;
      this.compose();
      const stream = this.out.captureStream(60);
      audioStream?.getAudioTracks().forEach((t) => stream.addTrack(t));
      const type = ['video/webm;codecs=vp9,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
      const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8e6 });
      const chunks = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        this.active = false;
        const blob = new Blob(chunks, { type: 'video/webm' });
        if (save) download(blob, `gesture-particles-${Date.now()}.webm`);
        resolve(blob);
      };
      rec.start(250);
      setTimeout(() => rec.stop(), seconds * 1000);
    });
  }
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
