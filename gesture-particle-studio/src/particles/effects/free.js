export default {
  create() {
    return {
      integrate(e, i, dt) {
        const d = Math.exp(-1.2 * dt);
        e.vx[i] *= d;
        e.vy[i] *= d;
        e.px[i] += e.vx[i] * dt;
        e.py[i] += e.vy[i] * dt;
      },
    };
  },
};
