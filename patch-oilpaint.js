// Adapted from Patch blendi/oil-paint @ 804c65f (MIT, see PATCH-LICENSE.txt).
const PatchOilPaint=(()=>{
// What every painted thing shares: the uniforms (sun, wind, land, shade maps, the brush sheet) and the GLSL that
// reads them. Colours here are paint, not light: they are picked as they should look on the canvas and are never
// tone-mapped, so a palette is three mixed colours (light, half-tone, shade) and a thing in the world chooses
// between them stroke by stroke.

const SUN = new THREE.Vector3(-0.44, 0.5, -0.75).normalize(); // a low autumn sun, ahead and to the left of the way in
const WIND = new THREE.Vector2(0.8, 0.6).normalize(); // blows toward the east and a little south
const EXTENT = 256; // the land map covers -EXTENT..EXTENT metres both ways
const LAND_RES = 1025;

const blank = (r, g, b, a) => {
  const t = new THREE.DataTexture(new Uint8Array([r, g, b, a]), 1, 1);
  t.needsUpdate = true;
  return t;
};

/** A tiling noise sheet: four unrelated smooth noises in the four channels, with mipmaps. */
function noiseSheet(size = 256, seed = 7) {
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const data = new Uint8Array(size * size * 4);
  for (let ch = 0; ch < 4; ch++) {
    const field = new Float32Array(size * size);
    // octaves of value noise on lattices that divide the sheet, so it tiles
    for (const [cells, amp] of [[8, 1], [16, 0.5], [32, 0.25], [64, 0.125]]) {
      const lat = new Float32Array(cells * cells);
      for (let i = 0; i < lat.length; i++) lat[i] = rnd();
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const fx = (x / size) * cells, fy = (y / size) * cells;
          const x0 = Math.floor(fx), y0 = Math.floor(fy);
          let tx = fx - x0, ty = fy - y0;
          tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
          const a = lat[(x0 % cells) + (y0 % cells) * cells], b = lat[((x0 + 1) % cells) + (y0 % cells) * cells];
          const c = lat[(x0 % cells) + ((y0 + 1) % cells) * cells], d = lat[((x0 + 1) % cells) + ((y0 + 1) % cells) * cells];
          field[x + y * size] += amp * (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty);
        }
      }
    }
    let lo = Infinity, hi = -Infinity;
    for (const v of field) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    for (let i = 0; i < field.length; i++) data[i * 4 + ch] = Math.round(((field[i] - lo) / (hi - lo)) * 255);
  }
  const t = new THREE.DataTexture(data, size, size);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

function createShared() {
  return {
    uTime: { value: 0 },
    uPixel: { value: 0.001 }, // metres one pixel covers at one metre from the eye
    uSunDir: { value: SUN.clone() },
    uWind: { value: new THREE.Vector3(WIND.x, WIND.y, 1) }, // direction on the ground (x, z) and strength
    uExtent: { value: EXTENT },
    tHeight: { value: blank(0, 0, 0, 0) },
    tLand: { value: blank(0, 0, 128, 0) }, // r path, g open to the sky (the clearing), b moss, a unused
    tNoise: { value: noiseSheet() },
    tBrush: { value: blank(255, 255, 128, 255) },
    tTreeShade: { value: null },
    uTreeShadeMat: { value: new THREE.Matrix4() },
    tFigShade: { value: null },
    uFigShadeMat: { value: new THREE.Matrix4() },
    uHaze: { value: new THREE.Color(0.6, 0.6, 0.67) },
    uHazeSun: { value: new THREE.Color(1.0, 0.89, 0.62) },
    uHazeDensity: { value: 0.0105 },
    uHazeGlow: { value: new THREE.Color(0.1, 0.08, 0.02) }, // what the air adds right round the sun
    uShadeBias: { value: 0.0009 }, // how far a spot must be behind the still world's shade to be in it
    uBounce: { value: new THREE.Color(0.1, 0.045, 0.0) }, // light the ground throws up into a figure's shade
    uLamp: { value: new THREE.Vector4(0, 0, 0, 0) }, // a light carried through the picture: where, and how strong (0: none)
    uLampCol: { value: new THREE.Color(1.0, 0.62, 0.25) },
    // the glaze a moving thing's shadow lays over the ground: the paint times the first, plus the second
    uGlazeMul: { value: new THREE.Color(0.5, 0.38, 0.46) },
    uGlazeAdd: { value: new THREE.Color(0.03, 0.02, 0.06) },
    uImpasto: { value: 1 },
    uFocus: { value: new THREE.Vector3() }, // where the wanderer stands
  };
}

const COMMON = /* glsl */ `
precision highp float;
precision highp sampler2DShadow;
#define TAU 6.28318530718
uniform float uTime;
uniform float uPixel;
uniform vec3 uSunDir;
uniform vec3 uWind;
uniform float uExtent;
uniform sampler2D tHeight;
uniform sampler2D tLand;
uniform sampler2D tNoise;
uniform sampler2D tBrush;
uniform sampler2DShadow tTreeShade;
uniform mat4 uTreeShadeMat;
uniform sampler2DShadow tFigShade;
uniform mat4 uFigShadeMat;
uniform vec3 uHaze;
uniform vec3 uHazeSun;
uniform float uHazeDensity;
uniform vec3 uHazeGlow;
uniform float uShadeBias;
uniform vec3 uBounce;
uniform vec4 uLamp;
uniform vec3 uLampCol;
uniform vec3 uGlazeMul;
uniform vec3 uGlazeAdd;
uniform float uImpasto;
uniform vec3 uFocus;

vec4 hash4(vec2 p, float salt) {
  vec4 q = fract(vec4(p.xyxy) * vec4(0.1031, 0.1030, 0.0973, 0.1099) + salt * 0.0713);
  q += dot(q, q.wzxy + 33.33);
  return fract((q.xxyz + q.yzzw) * q.zywx);
}
vec4 hash4(float n) {
  vec4 q = fract(vec4(n) * vec4(0.1031, 0.1030, 0.0973, 0.1099));
  q += dot(q, q.wzxy + 33.33);
  return fract((q.xxyz + q.yzzw) * q.zywx);
}

vec2 landUv(vec2 xz) { return (xz + uExtent) / (2.0 * uExtent) * (1024.0 / 1025.0) + 0.5 / 1025.0; }
float heightAt(vec2 xz) { return texture(tHeight, landUv(xz)).r; }
vec3 normalAt(vec2 xz) {
  const float e = 0.75;
  float hx = heightAt(xz + vec2(e, 0.0)) - heightAt(xz - vec2(e, 0.0));
  float hz = heightAt(xz + vec2(0.0, e)) - heightAt(xz - vec2(0.0, e));
  return normalize(vec3(-hx, 2.0 * e, -hz));
}

// Wind: bands crossing the wood with the wind, stretched along their fronts, with finer squalls inside.
float gustAt(vec2 xz) {
  vec2 w = uWind.xy;
  vec2 q = vec2(dot(xz, w), dot(xz, vec2(-w.y, w.x)));
  float a = texture(tNoise, vec2(q.x - uTime * 4.0, q.y * 0.45) / 95.0).r;
  float b = texture(tNoise, vec2(q.x - uTime * 6.5, q.y * 0.6) / 23.0 + 0.37).g;
  return clamp(smoothstep(0.36, 0.74, a) * 0.8 + (b - 0.5) * 0.6, 0.0, 1.0) * uWind.z;
}

// 1 in the sun, 0 in the wood's shade. That shade never moves, so a dab can take it whole.
float woodSunAt(vec3 world) {
  vec4 t = uTreeShadeMat * vec4(world, 1.0);
  float lit = smoothstep(0.56, 0.62, texture(tNoise, world.xz / 29.0).r); // beyond the picture of the shade: patches
  if (t.x > 0.0 && t.x < 1.0 && t.y > 0.0 && t.y < 1.0 && t.z < 1.0) lit = texture(tTreeShade, vec3(t.xy, t.z - uShadeBias));
  return lit;
}
// The wanderer's own shadow moves all the time (he breathes, his cloak blows), so it is read soft: a few looks
// round the spot, which turns its edge into a gradual thing instead of a line that dabs flick across.
float figSunSoft(vec3 f) {
  if (f.x <= 0.0 || f.x >= 1.0 || f.y <= 0.0 || f.y >= 1.0 || f.z >= 1.0) return 1.0;
  float z = f.z - 0.004;
  const float e = 0.013;
  float s = texture(tFigShade, vec3(f.xy, z)) * 0.28;
  s += texture(tFigShade, vec3(f.xy + vec2(e, e * 0.4), z)) * 0.18;
  s += texture(tFigShade, vec3(f.xy + vec2(-e * 0.4, e), z)) * 0.18;
  s += texture(tFigShade, vec3(f.xy + vec2(-e, -e * 0.4), z)) * 0.18;
  s += texture(tFigShade, vec3(f.xy + vec2(e * 0.4, -e), z)) * 0.18;
  return s;
}
float figSunAt(vec3 world) { return figSunSoft((uFigShadeMat * vec4(world, 1.0)).xyz); }
float sunAt(vec3 world) { return min(woodSunAt(world), figSunAt(world)); }

// The painter's three mixes. x is how lit the spot is; r moves the edges about so that one zone breaks into
// the next dab by dab.
vec3 paint3(vec3 cl, vec3 cm, vec3 cs, float x, float r) {
  x += (r - 0.5) * 0.2;
  vec3 c = mix(cs, cm, smoothstep(0.24, 0.36, x));
  return mix(c, cl, smoothstep(0.56, 0.7, x));
}

// Broken colour: every dab is mixed a little differently on the palette (value, hue, strength).
vec3 jitter(vec3 c, vec3 r, float amount) {
  float a = (r.y - 0.5) * 0.9 * amount;
  vec3 k = vec3(0.57735);
  c = c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a));
  float g = dot(c, vec3(0.3, 0.59, 0.11));
  c = mix(vec3(g), c, 1.0 + (r.z - 0.5) * 0.7 * amount);
  return max(c * (1.0 + (r.x - 0.5) * 0.5 * amount), 0.0);
}

// Mist: it lies low among the trunks, takes the sun's colour toward the sun and a grey violet away from it, and
// is what puts distance between one row of trees and the next.
vec3 airColour(vec3 v) {
  float sunward = max(dot(v, uSunDir), 0.0);
  vec3 air = mix(uHaze, uHazeSun, sunward * sunward);
  return air + uHazeGlow * pow(sunward, 12.0);
}

// A light carried through the picture, a lantern: how much of it falls on a spot that faces n. Add
// (the thing's own colour) * uLampCol * lampAt. It is nothing while uLamp.w is 0.
float lampAt(vec3 world, vec3 n) {
  vec3 to = uLamp.xyz - world;
  float d2 = dot(to, to);
  float face = clamp(dot(n, to) * inversesqrt(d2 + 1e-4) * 0.7 + 0.4, 0.0, 1.0);
  return uLamp.w * face / (1.0 + d2 * 0.2);
}
float mistBetween(vec3 world) {
  vec3 d = world - cameraPosition;
  float dist = length(d);
  float sunward = max(dot(d / dist, uSunDir), 0.0);
  float up = clamp((0.5 * (world.y + cameraPosition.y) - uFocus.y - 2.0) / 22.0, 0.0, 1.0);
  return 1.0 - exp(-dist * uHazeDensity * mix(1.2, 0.4, up) * (1.0 + 0.7 * sunward * sunward));
}
vec3 hazed(vec3 c, vec3 world) {
  return mix(c, airColour(normalize(world - cameraPosition)), mistBetween(world));
}
`;

// The brush sheet: eight marks of a loaded bristle brush, made here rather than drawn by anyone. Each cell holds
// one mark laid along +v: r is how thick the paint stands (for the light that rakes across it), g is where there
// is paint at all, b is a slow streak along the bristles (where a second colour was picked up and not mixed in).

const BRUSH_COLS = 4;
const BRUSH_ROWS = 2;
const CW = 128, CH = 256;

const hash = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const smooth = (t) => t * t * (3 - 2 * t);
const n1 = (x, seed) => {
  const i = Math.floor(x), f = smooth(x - i);
  return hash(i + seed * 57.3) * (1 - f) + hash(i + 1 + seed * 57.3) * f;
};
const n2 = (x, y, seed) => {
  const i = Math.floor(x), j = Math.floor(y), fx = smooth(x - i), fy = smooth(y - j);
  const h = (a, b) => hash(a * 1.31 + b * 91.7 + seed * 13.9);
  return (h(i, j) * (1 - fx) + h(i + 1, j) * fx) * (1 - fy) + (h(i, j + 1) * (1 - fx) + h(i + 1, j + 1) * fx) * fy;
};
const sstep = (a, b, x) => smooth(Math.min(1, Math.max(0, (x - a) / (b - a))));

// one mark: kind 0 a long stroke that runs dry, 1 a short fat dab, 2 a stroke with a curve to it
function mark(u, v, seed, kind) {
  const bend = kind === 2 ? (seed % 2 ? 0.34 : -0.34) : (hash(seed * 3.1) - 0.5) * 0.12;
  const ub = u - bend * (4 * (v - 0.5) * (v - 0.5) - 0.5);
  const wob = (n1(v * 5, seed + 3) - 0.5) * 0.1;
  const a = Math.abs(ub + wob);
  let half, start, end;
  if (kind === 1) {
    // a pressed dab: fat in the middle, ragged all round
    const r = Math.hypot(ub / 0.66, (v - 0.5) / 0.44);
    const edge = 1 + (n1(Math.atan2(v - 0.5, ub) * 2.2 + 9, seed) - 0.5) * 0.34;
    half = 0.66; start = 0; end = 1;
    const inside = 1 - sstep(edge - 0.16, edge, r);
    const bristle = n1(ub * 11, seed + 11);
    const dry = sstep(0.55, 1.0, r) * 0.9;
    const alpha = inside * (bristle > dry * 0.8 ? 1 : 0.25);
    const ridge = n1(ub * 13 + n1(v * 3, seed) * 1.5, seed + 31);
    const height = alpha * (0.4 + 0.22 * ridge * n1(ub * 9, seed + 5) + 0.3 * sstep(0.45, 0.95, r) + 0.12 * n2(ub * 4, v * 6, seed));
    return [height, alpha, n2(ub * 3.2, v * 1.3, seed + 20)];
  }
  half = 0.6 * (0.8 + 0.2 * Math.sin(Math.PI * Math.min(1, v * 1.15))) * (1 + (n1(v * 7, seed + 1) - 0.5) * 0.1);
  start = 0.05 + 0.05 * n1(ub * 5, seed + 2);
  end = 0.95 - 0.3 * n1(ub * 4.5 + 2, seed + 4) - 0.06 * n1(ub * 19, seed + 6);
  const side = 1 - sstep(half - 0.07, half, a);
  const head = sstep(start, start + 0.035, v);
  const tail = 1 - sstep(end - 0.02, end + 0.015, v);
  // the brush runs dry toward the end: single bristles give out and leave gaps
  const dryness = sstep(end - 0.2, end, v);
  const bristle = n1(ub * 13, seed + 8) * 0.7 + n1(ub * 31, seed + 9) * 0.3;
  const gap = 1 - sstep(dryness * 0.55 - 0.08, dryness * 0.55, bristle) < 0.5 ? 1.0 : 0.0;
  const alpha = side * head * tail * gap;
  const furrow = n1(ub * 12 + n1(v * 2.5, seed + 12) * 1.2, seed + 33) * 0.7 + n1(ub * 29, seed + 34) * 0.3;
  const load = 1 - 0.55 * sstep(0.1, 0.9, v); // thick where the brush touched down, thin where it left
  const squeezed = sstep(half - 0.3, half - 0.06, a); // paint pushed out to the sides of the stroke
  const height = alpha * (0.3 + 0.22 * furrow * (0.5 + 0.5 * n1(ub * 11, seed + 13)) + 0.3 * squeezed + 0.25 * load * (1 - sstep(start, start + 0.25, v)) + 0.1 * n2(ub * 3, v * 7, seed + 14));
  return [Math.min(1, height), alpha, n2(ub * 3.4, v * 1.1, seed + 20)];
}

function createBrushSheet() {
  const W = CW * BRUSH_COLS, H = CH * BRUSH_ROWS;
  const data = new Uint8Array(W * H * 4);
  const kinds = [0, 0, 0, 2, 1, 1, 0, 2];
  for (let cell = 0; cell < 8; cell++) {
    const cx = cell % BRUSH_COLS, cy = Math.floor(cell / BRUSH_COLS);
    for (let y = 0; y < CH; y++) {
      for (let x = 0; x < CW; x++) {
        // a margin of nothing round each mark, so the small copies of the sheet don't bleed into each other
        const u = ((x + 0.5) / CW) * 2 - 1, v = (y + 0.5) / CH;
        const m = 0.9;
        const [h, a, s] = Math.abs(u) > m || v < 0.04 || v > 0.96 ? [0, 0, 0.5] : mark(u / m, (v - 0.04) / 0.92, cell * 7 + 1, kinds[cell]);
        const i = ((cx * CW + x) + (cy * CH + y) * W) * 4;
        data[i] = Math.round(h * 255);
        data[i + 1] = Math.round(a * 255);
        data[i + 2] = Math.round(s * 255);
        data[i + 3] = 255;
      }
    }
  }
  const t = new THREE.DataTexture(data, W, H);
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

// A dab is one touch of the brush, pinned to a point of the world, turned to lie along a direction of the world (a
// trunk's grain, the fall of a cloak), in one mixed colour. Everything in the picture is made of them. Because each
// is pinned to the world, the paint stays on things as the eye moves.
//
// There are two ways a dab sits. Most are cards that face the eye: leaves, bark, cloth, anything with no one face.
// A dab on the ground lies flat on it instead (`lie`), a real patch of the surface: it is foreshortened like the
// ground it is on, it never turns as the eye moves, and where two overlap the one laid higher is on top from every
// side. Seen nearly edge on, a lying dab is stood up just enough to stay a stroke and not a hair.
//
// A thing that wants dabs gives `makeDab`, GLSL that fills in a Dab for this instance. Sizes are in metres but are
// kept between a least and a most size on the canvas, so far things are painted with fewer, larger touches.

const VERT = (head, body) => /* glsl */ `
${COMMON}
uniform vec2 uMinPx;
uniform vec2 uMaxPx;
uniform vec2 uCells; // first cell of the brush sheet and how many to choose from
out vec2 vUv;
out vec3 vC1;
out vec3 vC2;
out vec4 vAxis;
out vec4 vGlaze;
struct Dab {
  vec3 pos;    // where it is pinned
  vec3 dir;    // the way the stroke runs, in the world
  vec2 size;   // across and along, metres
  vec3 c1;     // its colour
  vec3 c2;     // the colour streaked into it
  float seed;
  float alive; // 0 gone .. 1 whole (it grows in)
  float lift;  // how far it stands off its surface toward the eye, in its own sizes
  float base;  // 1: pinned by its foot instead of its middle
  float spin;  // a turn on the canvas, radians
  float turnabout; // 1: laid with either end first
  float cell;  // which mark of the brush sheet, or -1 to let it choose
  float lie;   // 1: lies flat on its surface (nrm) instead of facing the eye
  vec3 nrm;    // the surface it lies on
  float height; // how far above the surface it is laid, metres: higher is on top
  float glaze; // 1: the wanderer's shadow passes over it as a glaze, pixel by pixel
};
${head}
void makeDab(inout Dab d);
${body}
void main() {
  Dab d;
  d.pos = vec3(0.0); d.dir = vec3(0.0, 1.0, 0.0); d.size = vec2(0.1, 0.2);
  d.c1 = vec3(0.5); d.c2 = vec3(0.5); d.seed = float(gl_InstanceID); d.alive = 1.0; d.lift = 0.6; d.base = 0.0; d.spin = 0.0; d.turnabout = 0.0; d.cell = -1.0;
  d.lie = 0.0; d.nrm = vec3(0.0, 1.0, 0.0); d.height = 0.0; d.glaze = 0.0;
  makeDab(d);
  vec4 r = hash4(d.seed * 1.37 + 5.1);
  vec2 across, along;
  vec4 vc;
  vGlaze = vec4(0.0);
  if (d.lie > 0.5) {
    vec3 Nn = normalize(d.nrm);
    vec3 A = d.dir - Nn * dot(d.dir, Nn);
    A = dot(A, A) > 1e-8 ? normalize(A) : normalize(cross(Nn, vec3(1.0, 0.0, 0.0)));
    vec3 B = cross(Nn, A);
    vec3 P = d.pos + Nn * d.height;
    vc = viewMatrix * vec4(P, 1.0);
    float dist = -vc.z;
    if (d.alive < 0.004 || dist < 0.1) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    vec2 half_ = d.size * 0.5 * d.alive;
    vec3 world = P + A * position.y * half_.y + B * position.x * half_.x;
    if (d.glaze > 0.5) vGlaze = vec4((uFigShadeMat * vec4(world, 1.0)).xyz, 1.0);
    vec3 a = mat3(viewMatrix) * A * half_.y;
    vec3 b = mat3(viewMatrix) * B * half_.x;
    // on the canvas the patch is a slanted box; if its thin way is under the least size, stand it up to that
    float la = length(a.xy), lb = length(b.xy);
    float thin = abs(a.x * b.y - a.y * b.x) / max(max(la, lb), 1e-6);
    float need = uMinPx.x * 0.5 * dist * uPixel * d.alive;
    if (thin < need) {
      if (la > lb) {
        vec2 perp = vec2(-a.y, a.x) / max(la, 1e-6);
        b.xy += perp * (dot(b.xy, perp) < 0.0 ? -1.0 : 1.0) * (need - thin);
      } else {
        vec2 perp = vec2(-b.y, b.x) / max(lb, 1e-6);
        a.xy += perp * (dot(a.xy, perp) < 0.0 ? -1.0 : 1.0) * (need - thin);
      }
    }
    vc.xyz += a * position.y + b * position.x;
    along = normalize(a.xy + 1e-6);
    across = normalize(b.xy + 1e-6);
  } else {
    vc = viewMatrix * vec4(d.pos, 1.0);
    float dist = -vc.z;
    if (d.alive < 0.004 || dist < 0.1) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    vec3 vd = mat3(viewMatrix) * normalize(d.dir);
    float flatness = length(vd.xy);
    float a0 = r.x * TAU;
    along = flatness > 1e-4 ? vd.xy / flatness : vec2(0.0, 1.0);
    // a stroke that points at the eye has no direction on the canvas: give it its own
    along = normalize(mix(vec2(cos(a0), sin(a0)), along, smoothstep(0.08, 0.4, flatness)));
    float cs = cos(d.spin), sn = sin(d.spin);
    along = vec2(along.x * cs - along.y * sn, along.x * sn + along.y * cs);
    across = vec2(along.y, -along.x);
    float px = dist * uPixel;
    vec2 half_ = clamp(d.size, uMinPx * px, uMaxPx * px) * 0.5 * d.alive;
    float lift = d.lift * max(half_.x, half_.y) * (0.6 + 0.8 * r.y);
    vc.xyz *= 1.0 - min(lift / dist, 0.3);
    float t = mix(position.y, position.y + 1.0, d.base);
    vc.xy += across * position.x * half_.x + along * t * half_.y;
  }
  gl_Position = projectionMatrix * vc;
  float cell = d.cell >= 0.0 ? d.cell : uCells.x + floor(r.z * uCells.y * 0.999);
  float flip = r.w > 0.5 ? -1.0 : 1.0;
  float end_ = d.turnabout > 0.5 && fract(r.x * 7.13) > 0.5 ? -1.0 : 1.0;
  vec2 q = vec2(position.x * flip, position.y * end_) * 0.5 + 0.5;
  vUv = (vec2(mod(cell, ${BRUSH_COLS}.0), floor(cell / ${BRUSH_COLS}.0)) + q) / vec2(${BRUSH_COLS}.0, ${BRUSH_ROWS}.0);
  vC1 = d.c1;
  vC2 = d.c2;
  vAxis = vec4(across * flip, along * end_);
}
`;

const FRAG = /* glsl */ `
${COMMON}
in vec2 vUv;
in vec3 vC1;
in vec3 vC2;
in vec4 vAxis;
in vec4 vGlaze;
layout(location = 0) out vec4 outC;
void main() {
  vec4 t = texture(tBrush, vUv);
  if (t.g < 0.3) discard;
  vec2 e = vec2(1.5 / 512.0, 0.0);
  float hu = texture(tBrush, vUv + e.xy).r - texture(tBrush, vUv - e.xy).r;
  float hv = texture(tBrush, vUv + e.yx).r - texture(tBrush, vUv - e.yx).r;
  // the paint stands up off the canvas and the room's light, from the upper left, rakes across it
  vec2 g = vAxis.xy * hu + vAxis.zw * hv;
  float rake = 0.5 * g.x - 0.7 * g.y;
  vec3 col = mix(vC1, vC2, smoothstep(0.52, 0.78, t.b));
  // Ship and walker use Star Sea's own moving-shadow pass.
  col *= mix(0.95, 1.04, t.r);
  col *= 1.0 + rake * 1.25 * uImpasto;
  col += vec3(1.0, 0.97, 0.9) * pow(max(rake, 0.0), 2.0) * 1.2 * uImpasto;
  outC = vec4(col, smoothstep(0.3, 0.62, t.g));
}
`;

function dabMaterial(shared, { head = '', body, uniforms = {}, minPx = [5, 9], maxPx = [400, 700], cells = [0, 8], depthTest = true, depthWrite = true } = {}) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERT(head, body),
    fragmentShader: FRAG,
    uniforms: {
      ...shared,
      uMinPx: { value: new THREE.Vector2(...minPx) },
      uMaxPx: { value: new THREE.Vector2(...maxPx) },
      uCells: { value: new THREE.Vector2(...cells) },
      ...uniforms,
    },
    side: THREE.DoubleSide,
    alphaToCoverage: true,
    depthTest,
    depthWrite,
  });
}

/** The card every dab is drawn with, `count` times; `attributes` are per dab: { name: [Float32Array, itemSize] }. */
function dabGeometry(count, attributes = {}, dynamic = false) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  for (const [name, [array, size]] of Object.entries(attributes)) {
    const a = new THREE.InstancedBufferAttribute(array, size);
    if (dynamic) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute(name, a);
  }
  g.instanceCount = count;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

function dabMesh(geometry, material, order = 0) {
  const m = new THREE.Mesh(geometry, material);
  m.frustumCulled = false;
  m.matrixAutoUpdate = false;
  m.renderOrder = order;
  return m;
}

return {createShared,createBrushSheet,dabGeometry,dabMaterial,dabMesh};
})();
