'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// sim-shaders.js  —  wszystkie shadery GLSL jako string constants
// Użycie:  new THREE.ShaderMaterial({ vertexShader: CLOUD_VERT, ... })
// ═══════════════════════════════════════════════════════════════════════════════

// ── Chmury (Points billboard) ─────────────────────────────────────────────────

const CLOUD_VERT = /* glsl */`
  attribute float aSize;
  attribute float aOpacity;
  attribute float aType;   // 0=cumulus, 1=stratus
  varying float   vOpacity;
  varying float   vType;

  void main() {
    vOpacity = aOpacity;
    vType    = aType;
    vec4 mv  = modelViewMatrix * vec4(position, 1.0);
    float ps = aSize * (800.0 / -mv.z);
    gl_PointSize = clamp(ps, 1.0, 1024.0);
    gl_Position  = projectionMatrix * mv;
  }
`;

const CLOUD_FRAG = /* glsl */`
  uniform float uCoverage;
  uniform float uTime;
  uniform vec3  uSkyColor;
  varying float vOpacity;
  varying float vType;

  // Wartość hash 2D → [0,1]
  float hash2(vec2 p) {
    p  = fract(p * vec2(127.34, 311.17));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  // Value noise
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash2(i),           hash2(i + vec2(1,0)), f.x),
      mix(hash2(i + vec2(0,1)), hash2(i + vec2(1,1)), f.x), f.y);
  }
  // fBM 3 oktawy
  float fbm(vec2 p) {
    float v = 0.0, a = 0.6;
    for (int i = 0; i < 3; i++) { v += a * vnoise(p); p *= 2.1; a *= 0.5; }
    return v;
  }

  void main() {
    vec2  uv   = gl_PointCoord - 0.5;
    float dist = length(uv) * 2.0;
    if (dist > 1.0) discard;

    // Noise dla nieregularnych krawędzi
    vec2 nuv = gl_PointCoord * 4.5 + uTime * 0.008;
    float n  = fbm(nuv);
    float n2 = fbm(nuv * 2.1 - uTime * 0.005);

    // Krawędź chmury
    float soft  = mix(0.35, 0.55, n);
    float hard  = mix(0.75, 0.95, n2);
    float edge  = 1.0 - smoothstep(soft, hard, dist);
    float alpha = edge * vOpacity * min(uCoverage * 2.5, 1.0);
    alpha = clamp(alpha, 0.0, 0.95);
    if (alpha < 0.015) discard;

    // Kolor: jaśniejszy środek, ciemniejszy spód (vType=0 cumulus, 1 stratus)
    float bright = mix(0.96, 0.82, dist * 0.7 + vType * 0.15);
    // Lekkie zabarwienie niebem na brzegach
    vec3 col = mix(vec3(bright), uSkyColor, dist * 0.15);
    gl_FragColor = vec4(col, alpha);
  }
`;

// ── Deszcz 3D (Points) ─────────────────────────────────────────────────────────

const RAIN_VERT = /* glsl */`
  attribute float aLife;
  varying float   vLife;
  void main() {
    vLife       = aLife;
    gl_PointSize = 1.5;
    gl_Position  = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const RAIN_FRAG = /* glsl */`
  uniform float uIntensity;
  varying float vLife;
  void main() {
    gl_FragColor = vec4(0.72, 0.84, 0.95, 0.30 * uIntensity * vLife);
  }
`;

// ── Śnieg 3D (Points) ─────────────────────────────────────────────────────────

const SNOW_VERT = /* glsl */`
  attribute float aSize;
  void main() {
    vec4 mv      = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (200.0 / -mv.z);
    gl_PointSize = clamp(gl_PointSize, 1.0, 12.0);
    gl_Position  = projectionMatrix * mv;
  }
`;

const SNOW_FRAG = /* glsl */`
  uniform float uIntensity;
  void main() {
    float d = distance(gl_PointCoord, vec2(0.5));
    if (d > 0.5) discard;
    float a = (1.0 - d * 2.0) * 0.75 * uIntensity;
    gl_FragColor = vec4(0.95, 0.97, 1.0, a);
  }
`;
