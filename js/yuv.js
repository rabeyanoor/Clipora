// Canvas → I420 (YUV 4:2:0) frames in standard BT.709 *limited* range.
// Encoding the canvas directly gives full-range / sRGB-tagged video, which many
// players (phone galleries, WhatsApp, Instagram) show with different colors.
// The conversion runs on the GPU (WebGL2): one draw packs the Y, U and V planes
// into an RGBA texture that reads back as a ready-made I420 buffer.

export const BT709 = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false };

const VS = `#version 300 es
in vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

// Output row y < H: Y plane (4 luma bytes per RGBA texel).
// Next H/4 rows: U plane, then H/4 rows: V plane (each byte = average of a 2x2 block).
const FS = `#version 300 es
precision highp float;
uniform sampler2D src; uniform vec2 size; out vec4 o;
vec3 rgbAt(vec2 px) { return texture(src, px / size).rgb; }
float Y(vec3 c) { return (16.0 + 219.0 * dot(c, vec3(0.2126, 0.7152, 0.0722))) / 255.0; }
float U(vec3 c) { return (128.0 + 224.0 * dot(c, vec3(-0.114572, -0.385428, 0.5))) / 255.0; }
float V(vec3 c) { return (128.0 + 224.0 * dot(c, vec3(0.5, -0.454153, -0.045847))) / 255.0; }
void main() {
  float W = size.x, H = size.y;
  float x = floor(gl_FragCoord.x), y = floor(gl_FragCoord.y);
  vec4 r;
  if (y < H) {
    for (int j = 0; j < 4; j++) r[j] = Y(rgbAt(vec2(4.0 * x + float(j) + 0.5, y + 0.5)));
  } else {
    bool isV = y >= H * 1.25;
    float k = y - (isV ? H * 1.25 : H);
    for (int j = 0; j < 4; j++) {
      float b = k * W + 4.0 * x + float(j);
      float row = floor(b / (W * 0.5)), col = b - row * W * 0.5;
      vec3 c = rgbAt(vec2(2.0 * col + 1.0, 2.0 * row + 1.0)); // linear filter = 2x2 average
      r[j] = isV ? V(c) : U(c);
    }
  }
  o = r;
}`;

/** Returns a converter `(canvas) => Uint8Array (I420)` for W×H, or null if WebGL2 is unavailable. */
export function gpuConverter(W, H) {
  if (W % 8 || H % 4) return null;
  const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W / 4, H * 1.5) : Object.assign(document.createElement('canvas'), { width: W / 4, height: H * 1.5 });
  const gl = cv.getContext('webgl2', { antialias: false, depth: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
  if (!gl) return null;
  const sh = (type, s) => {
    const x = gl.createShader(type);
    gl.shaderSource(x, s);
    gl.compileShader(x);
    if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x));
    return x;
  };
  try {
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(gl.getUniformLocation(prog, 'size'), W, H);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.viewport(0, 0, W / 4, H * 1.5);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    return (canvas) => {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const out = new Uint8Array(W * H * 1.5);
      gl.readPixels(0, 0, W / 4, H * 1.5, gl.RGBA, gl.UNSIGNED_BYTE, out);
      return out;
    };
  } catch (e) {
    console.warn('[Clipora] GPU color conversion unavailable', e);
    return null;
  }
}

/** CPU fallback (any even size). Slower, but gives identical colors. */
export function cpuConverter(W, H) {
  const ctx = (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H })).getContext('2d', { willReadFrequently: true });
  return (canvas) => {
    ctx.drawImage(canvas, 0, 0, W, H);
    return rgbaToI420(ctx.getImageData(0, 0, W, H).data, W, H);
  };
}

/** RGBA bytes → I420 BT.709 limited range. W and H must be even. */
export function rgbaToI420(px, W, H) {
  const out = new Uint8Array(W * H * 1.5);
  const cw = W >> 1;
  const uo = W * H;
  const vo = uo + (W * H) / 4;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      out[y * W + x] = 16 + ((219 * (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2])) / 255 + 0.5) | 0;
    }
  }
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      const a = (y * W + x) * 4;
      const b = a + W * 4;
      const r = (px[a] + px[a + 4] + px[b] + px[b + 4]) / 4;
      const g = (px[a + 1] + px[a + 5] + px[b + 1] + px[b + 5]) / 4;
      const bl = (px[a + 2] + px[a + 6] + px[b + 2] + px[b + 6]) / 4;
      const k = (y >> 1) * cw + (x >> 1);
      out[uo + k] = (128 + (224 * (-0.114572 * r - 0.385428 * g + 0.5 * bl)) / 255 + 0.5) | 0;
      out[vo + k] = (128 + (224 * (0.5 * r - 0.454153 * g - 0.045847 * bl)) / 255 + 0.5) | 0;
    }
  }
  return out;
}
