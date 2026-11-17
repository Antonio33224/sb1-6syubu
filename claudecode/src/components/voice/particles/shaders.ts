/**
 * GLSL do orbe: ruído simplex 3D (Ashima/Stefan Gustavson, MIT), curl noise,
 * deformação do geoide e os shaders da simulação GPGPU (ping-pong FBO).
 */

export const NOISE = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

vec3 snoiseVec3(vec3 x) {
  return vec3(
    snoise(x),
    snoise(vec3(x.y - 19.1, x.z + 33.4, x.x + 47.2)),
    snoise(vec3(x.z + 74.2, x.x - 124.5, x.y + 99.4))
  );
}

// Curl do campo vetorial de ruído: fluxo sem divergência (turbulento e fluido).
vec3 curlNoise(vec3 p) {
  const float e = 0.1;
  vec3 dx = vec3(e, 0.0, 0.0);
  vec3 dy = vec3(0.0, e, 0.0);
  vec3 dz = vec3(0.0, 0.0, e);
  vec3 px0 = snoiseVec3(p - dx); vec3 px1 = snoiseVec3(p + dx);
  vec3 py0 = snoiseVec3(p - dy); vec3 py1 = snoiseVec3(p + dy);
  vec3 pz0 = snoiseVec3(p - dz); vec3 pz1 = snoiseVec3(p + dz);
  float x = py1.z - py0.z - pz1.y + pz0.y;
  float y = pz1.x - pz0.x - px1.z + px0.z;
  float z = px1.y - px0.y - py1.x + py0.x;
  return normalize(vec3(x, y, z) / (2.0 * e) + 1e-6);
}

// "Batata gravitacional": várias oitavas de simplex, andando devagar no tempo.
float geoid(vec3 n, float t) {
  float h = 0.0;
  float a = 0.5;
  float f = 1.1;
  for (int i = 0; i < 3; i++) {
    h += a * snoise(n * f + vec3(0.0, t * 0.06, t * 0.04));
    f *= 2.03;
    a *= 0.5;
  }
  return h;
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 randDir(vec2 uv, float seed) {
  float u = hash12(uv * 91.3 + seed);
  float v = hash12(uv * 47.7 + seed * 1.37 + 11.0);
  float th = 6.2831853 * u;
  float z = 2.0 * v - 1.0;
  float r = sqrt(max(0.0, 1.0 - z * z));
  return vec3(r * cos(th), z, r * sin(th));
}
`;

const SIM_UNIFORMS = /* glsl */ `
uniform float uTime;
uniform float uDt;
uniform float uSeed;
uniform float uLifeRate;
uniform float uAmp;
uniform float uSpeed;
uniform float uCurl;
uniform float uOrbit;
uniform float uCondense;
`;

/** Posição (xyz) + idade normalizada (w). Renasce na superfície deformada do geoide. */
export const POSITION_SHADER = /* glsl */ `
${SIM_UNIFORMS}
${NOISE}
void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 pos = texture2D(texturePosition, uv);
  vec4 vel = texture2D(textureVelocity, uv);
  float life = pos.w + uDt * uLifeRate * (0.6 + 0.8 * vel.w);
  if (life >= 1.0) {
    vec3 n = randDir(uv, uSeed);
    pos.xyz = n * (1.0 + uAmp * geoid(n, uTime));
    life = 0.0;
  } else {
    pos.xyz += vel.xyz * uDt;
  }
  gl_FragColor = vec4(pos.xyz, life);
}
`;

/** Velocidade (xyz) + semente fixa da partícula (w). */
export const VELOCITY_SHADER = /* glsl */ `
${SIM_UNIFORMS}
${NOISE}
void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 pos = texture2D(texturePosition, uv);
  vec4 vel = texture2D(textureVelocity, uv);
  float life = pos.w + uDt * uLifeRate * (0.6 + 0.8 * vel.w);
  vec3 v;
  if (life >= 1.0) {
    // Mesmo ponto de nascimento do shader de posição (mesma semente): sai pela normal.
    vec3 n = randDir(uv, uSeed);
    v = n * (0.22 + 0.35 * hash12(uv * 13.1 + uSeed)) * uSpeed;
  } else {
    vec3 p = pos.xyz;
    v = vel.xyz;
    v += curlNoise(p * 0.9 + vec3(0.0, uTime * 0.08, 0.0)) * uCurl * uSpeed * uDt;
    vec3 tang = normalize(cross(vec3(0.0, 1.0, 0.0), p) + 1e-5);
    v += tang * uOrbit * uDt;
    float r = length(p);
    v -= normalize(p + 1e-5) * (r - 1.28) * uCondense * uDt * 2.2;
    v *= 1.0 - min(0.9, 0.85 * uDt);
  }
  gl_FragColor = vec4(v, vel.w);
}
`;

const COLOR_UNIFORMS = /* glsl */ `
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec3 uColC;
uniform float uIntensity;
uniform float uDesat;
vec3 desat(vec3 c) { return mix(c, vec3(dot(c, vec3(0.299, 0.587, 0.114))), uDesat); }
`;

export const GEOID_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uAmp;
uniform float uPixelRatio;
uniform float uPointSize;
uniform float uScale;
varying float vH;
varying float vFres;
${NOISE}
void main() {
  vec3 n = normalize(position);
  float h = geoid(n, uTime);
  vec3 p = n * (1.0 + uAmp * h) * uScale;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec3 vn = normalize(normalMatrix * n);
  vFres = pow(1.0 - abs(dot(vn, normalize(-mv.xyz))), 2.2);
  vH = h;
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uPointSize * uPixelRatio * (3.0 / -mv.z);
}
`;

export const GEOID_FRAGMENT = /* glsl */ `
${COLOR_UNIFORMS}
varying float vH;
varying float vFres;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float soft = smoothstep(0.5, 0.0, d);
  // Gradiente pela altura da deformação: vales violeta → azul → picos ciano.
  vec3 col = mix(uColC, uColA, smoothstep(-0.6, 0.15, vH));
  col = mix(col, uColB, smoothstep(0.15, 0.7, vH));
  float a = (0.03 + 0.55 * vFres) * soft * uIntensity;
  gl_FragColor = vec4(desat(col), a);
}
`;

export const PARTICLE_VERTEX = /* glsl */ `
uniform sampler2D uPositions;
uniform float uPixelRatio;
uniform float uSize;
attribute vec2 reference;
attribute float seed;
varying float vLife;
varying float vSeed;
varying float vDepth;
void main() {
  vec4 p = texture2D(uPositions, reference);
  vLife = p.w;
  vSeed = seed;
  vec4 mv = modelViewMatrix * vec4(p.xyz, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
  float grow = smoothstep(0.0, 0.06, p.w);
  float shrink = pow(1.0 - p.w, 0.8);
  gl_PointSize = uSize * uPixelRatio * grow * shrink * (0.6 + 0.8 * seed) * (3.0 / -mv.z);
}
`;

export const PARTICLE_FRAGMENT = /* glsl */ `
${COLOR_UNIFORMS}
uniform float uCamDist;
varying float vLife;
varying float vSeed;
varying float vDepth;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float soft = pow(smoothstep(0.5, 0.0, d), 1.6);
  vec3 col = mix(uColA, uColB, smoothstep(0.55, 1.0, vSeed));
  col = mix(col, uColC, smoothstep(0.45, 0.0, vSeed) * 0.85);
  col = mix(col, vec3(1.0), (1.0 - vLife) * 0.12);
  // Profundidade: partículas mais distantes da câmera ficam mais escuras.
  float depth = clamp(1.0 - (vDepth - (uCamDist - 1.6)) / 3.2, 0.22, 1.0);
  // Dezenas de milhares de pontos em blending aditivo: alfa baixo evita saturar em branco.
  float alpha = soft * (1.0 - vLife) * uIntensity * depth * 0.22;
  gl_FragColor = vec4(desat(col) * depth, alpha);
}
`;
