// public/js/render/fx/rings.js — FxSystem ground rings and the fallback cast cue.
// Installed on FxSystem.prototype by ./system.js (a method container: never instantiated; `this` is the effect system).

import { SKILL_GOLD, easeOut } from './limits.js';

export class FxRings {
  // ---- rings / auras -----------------------------------------------------------------------------------------

  /**
   * Ground ring going from r0 to r1 tiles over `dur` real seconds (easing out, fading). `mode` 'in': a warning closing
   * in — linear, brightening towards its end; 'pulse': throbbing at full size until its end.
   */
  ring(x, y, z, r0, r1, tint, dur = 0.4, tex = 'ring', mode = null) {
    const P = this.P;
    let r = this.ringFree.pop();
    if (!r) {
      const sp = new P.Sprite(this.tex[tex]);
      sp.anchor.set(0.5);
      sp.blendMode = P.BLEND_MODES.ADD;
      this.ctx.layers.groundFx.addChild(sp);
      r = { sp };
    }
    r.sp.texture = this.tex[tex] || this.tex.ring;
    r.sp.visible = true;
    r.sp.tint = tint;
    r.sp.alpha = 0;
    this._onGround(r.sp, y, z);
    r.x = x; r.y = y; r.z = z; r.r0 = r0; r.r1 = r1; r.t = 0; r.dur = Math.max(0.01, dur); r.mode = mode;
    this.rings.push(r);
    if (this.rings.length > 80) { const o = this.rings.shift(); o.sp.visible = false; this.ringFree.push(o); }
  }

  _updateRings(dt) {
    const cam = this.ctx.cam();
    const p = this._p, q = this._q;
    let w = 0;
    for (const r of this.rings) {
      r.t += dt;
      if (r.t >= r.dur) { r.sp.visible = false; this.ringFree.push(r); continue; }
      const u = r.t / r.dur;
      const k = r.mode === 'in' ? u : easeOut(u);
      const rad = r.r0 + (r.r1 - r.r0) * k;
      cam.project(r.x, r.y, r.z + 0.01, p);
      cam.project(r.x, r.y + rad, r.z + 0.01, q);
      const rx = p.s * rad, ry = Math.max(1, p.y - q.y);
      r.sp.position.set(p.x, p.y);
      r.sp.scale.set((rx * 2) / 128, (ry * 2) / 128);
      r.sp.alpha = r.mode === 'in' ? 0.35 + 0.65 * u
        : r.mode === 'pulse' ? (0.35 + 0.35 * Math.abs(Math.sin(r.t * 9))) * Math.min(1, (r.dur - r.t) / 0.06, r.t / 0.06)
          : 1 - u;
      this.rings[w++] = r;
    }
    this.rings.length = w;
  }

  /** A cast cue only when neither an official effect nor a plugin takes it. */
  skill(view, on) {
    if (!view || !on) return;
    const { x, y, s } = this._chest(view);
    this.particle('flare', x, y, { tint: SKILL_GOLD, life: 0.22, s0: (s / 128) * 0.67, s1: (s / 128) * 0.3, a0: 0.8, a1: 0 });
  }
}
