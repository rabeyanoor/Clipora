// GPU image processing (WebGL). One shader handles per-clip adjustments
// (Enhance / sharpen / smooth skin / exposure / temperature / shadows …),
// chroma key for overlays, and whole-frame effects (glitch, VHS, shake …).
// If WebGL is unavailable, `Gfx.ok` is false and the engine skips these.

const VS = `attribute vec2 p; varying vec2 v;
void main(){ v = p * .5 + .5; gl_Position = vec4(p, 0., 1.); }`;

const FS = `precision mediump float;
varying vec2 v;
uniform sampler2D u;
uniform vec2 px;
uniform float exposure, temp, tint, highlights, shadows, vignette, grain, sharpen, smoothSkin, gain, vibrance, time;
uniform float rgb, scan, bw, flash, zoom, mirror, invert, pixelate;
uniform vec2 shift;
uniform vec3 keyColor;
uniform float keyStrength;
float luma(vec3 c){ return dot(c, vec3(.299, .587, .114)); }
float rnd(vec2 co){ return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
vec2 cbcr(vec3 c){ return vec2(-.169 * c.r - .331 * c.g + .5 * c.b, .5 * c.r - .419 * c.g - .081 * c.b); }
void main(){
  vec2 uv = (v - .5) / zoom + .5 + shift;
  if (mirror > .5 && uv.x > .5) uv.x = 1. - uv.x;
  if (pixelate > 0.) { vec2 cell = px * pixelate; uv = (floor(uv / cell) + .5) * cell; }
  vec4 t = texture2D(u, uv);
  vec3 c = t.rgb;
  if (rgb > 0.) {
    c.r = texture2D(u, uv + vec2(rgb, 0.)).r;
    c.b = texture2D(u, uv - vec2(rgb, 0.)).b;
  }
  if (smoothSkin > 0. || sharpen > 0.) {
    vec3 n = texture2D(u, uv + vec2(px.x, 0.)).rgb + texture2D(u, uv - vec2(px.x, 0.)).rgb
           + texture2D(u, uv + vec2(0., px.y)).rgb + texture2D(u, uv - vec2(0., px.y)).rgb;
    vec3 d = texture2D(u, uv + px).rgb + texture2D(u, uv - px).rgb
           + texture2D(u, uv + vec2(px.x, -px.y)).rgb + texture2D(u, uv + vec2(-px.x, px.y)).rgb;
    vec3 blur = (c * 4. + n * 2. + d) / 16.;
    if (smoothSkin > 0.) {
      float e = length(c - blur);
      c = mix(c, blur, smoothSkin * (1. - smoothstep(.015, .09, e)));
    }
    if (sharpen > 0.) c += (c - blur) * sharpen * 3.;
  }
  c *= gain * exp2(exposure);
  float l = luma(c);
  c += shadows * (1. - smoothstep(0., .55, l)) * .3;
  c += highlights * smoothstep(.45, 1., l) * .3;
  c.r += temp * .08; c.b -= temp * .08; c.g += tint * .06;
  if (vibrance != 0.) {
    float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
    c = mix(vec3(luma(c)), c, 1. + vibrance * (1. - (mx - mn)));
  }
  float a = 1.;
  if (keyStrength > 0.) {
    float dist = distance(cbcr(t.rgb), cbcr(keyColor));
    float th = .04 + keyStrength * .16;
    a = smoothstep(th, th + .06, dist);
    c = mix(c, vec3(luma(c)), (1. - smoothstep(th, th + .15, dist)) * .6); // spill suppression
  }
  if (bw > 0.) c = mix(c, vec3(luma(c)), bw);
  if (invert > 0.) c = mix(c, 1. - c, invert);
  if (vignette > 0.) c *= 1. - vignette * smoothstep(.25, .85, distance(v, vec2(.5)));
  if (grain > 0.) c += (rnd(v * 913. + time) - .5) * grain * .2;
  if (scan > 0.) c *= 1. - scan * .3 * step(.5, fract(v.y / px.y / 4.));
  c = mix(c, vec3(1.), flash);
  a *= t.a;
  gl_FragColor = vec4(clamp(c, 0., 1.) * a, a);
}`;

export const NEUTRAL = {
  exposure: 0, temp: 0, tint: 0, highlights: 0, shadows: 0, vignette: 0, grain: 0, sharpen: 0, smoothSkin: 0,
  gain: 1, vibrance: 0, rgb: 0, scan: 0, bw: 0, flash: 0, zoom: 1, mirror: 0, invert: 0, pixelate: 0,
  shift: [0, 0], keyColor: [0, 1, 0], keyStrength: 0,
};

export class Gfx {
  constructor() {
    this.canvas = document.createElement('canvas');
    const gl = this.canvas.getContext('webgl', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false });
    this.ok = false;
    if (!gl) return;
    try {
      const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'p');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      this.loc = {};
      for (const k of [...Object.keys(NEUTRAL), 'px', 'time']) this.loc[k] = gl.getUniformLocation(prog, k);
      this.gl = gl;
      this.ok = true;
    } catch (e) {
      console.warn('[Clipora] WebGL unavailable', e);
    }
  }

  /** Renders `source` through the shader at w×h and returns the WebGL canvas (valid until the next call). */
  process(source, w, h, params = {}, time = 0) {
    const { gl, loc } = this;
    w = Math.max(2, Math.round(w));
    h = Math.max(2, Math.round(h));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    const P = { ...NEUTRAL, ...params };
    for (const [k, v] of Object.entries(P)) {
      if (!loc[k]) continue;
      if (Array.isArray(v)) v.length === 3 ? gl.uniform3fv(loc[k], v) : gl.uniform2fv(loc[k], v);
      else gl.uniform1f(loc[k], v);
    }
    gl.uniform2f(loc.px, 1 / w, 1 / h);
    gl.uniform1f(loc.time, time % 100);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.canvas;
  }
}

export const hexToRgb = (hex) => {
  const n = parseInt(String(hex).replace('#', ''), 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
