'use strict';

// ════════════════════════════════════════════════════════════════════════════════
// sim-sky.js  —  Fizyczne niebo (Rayleigh/Mie scattering) + Słońce/Księżyc
//                + chmury wolumetryczne (raymarching) + deszcz kierunkowy.
//
// Zastępuje CAŁKOWICIE starą zawartość sim-shaders.js (SKY_*/CLOUD_*/SNOW_*)
// oraz część sim-weather.js odpowiedzialną za sky dome / chmury / deszcz 3D.
//
// Korzysta z istniejących globali: scene, camera, renderer (sim-scene.js),
// refLat/refLon/Y_SCALE/Units (sim-constants.js), activeEntity (sim-entity.js),
// WeatherState (sim-weather.js, ładowany PRZED tym plikiem), weather (instancja
// WeatherSystem, tworzona później w sim-main.js — odwołania do niej są leniwe,
// więc kolejność wczytania jest bezpieczna).
//
// Pozycja Słońca/Księżyca liczona jest z refLat/refLon (czyli aktualnie
// wybranego lotniska) + TimeState (godzina/dzień roku, sterowane suwakiem
// w panelu POGODA, z opcjonalną animacją).
// ════════════════════════════════════════════════════════════════════════════════

// ── Małe helpery (bez zależności od THREE.MathUtils — spójnie z resztą kodu) ──
function _lerp(a, b, t) { return a + (b - a) * t; }
function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ════════════════════════════════════════════════════════════════════════════════
// ASTRONOMIA — pozycja Słońca i Księżyca z lat/lon/daty
// ════════════════════════════════════════════════════════════════════════════════
const Astro = (() => {
  const rad = Math.PI / 180;

  function sunPosition(date, lat, lon) {
    const J2000 = Date.UTC(2000, 0, 1, 12, 0, 0);
    const d = (date.getTime() - J2000) / 86400000;

    const meanLon = (280.460 + 0.9856474 * d) % 360;
    const meanAnomaly = ((357.528 + 0.9856003 * d) % 360) * rad;
    const eclipticLon = (meanLon + 1.915 * Math.sin(meanAnomaly) + 0.020 * Math.sin(2 * meanAnomaly)) * rad;
    const obliquity = (23.439 - 0.0000004 * d) * rad;

    const ra = Math.atan2(Math.cos(obliquity) * Math.sin(eclipticLon), Math.cos(eclipticLon));
    const decl = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLon));

    const gmst = (280.46061837 + 360.98564736629 * d) % 360;
    const lst = (gmst + lon) * rad;
    let hourAngle = lst - ra;
    hourAngle = ((hourAngle + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;

    const latRad = lat * rad;
    const altitude = Math.asin(
      Math.sin(latRad) * Math.sin(decl) + Math.cos(latRad) * Math.cos(decl) * Math.cos(hourAngle)
    );
    let azimuth = Math.atan2(
      -Math.sin(hourAngle),
      Math.tan(decl) * Math.cos(latRad) - Math.sin(latRad) * Math.cos(hourAngle)
    );
    azimuth = (azimuth + 2 * Math.PI) % (2 * Math.PI);

    return { altitude, azimuth, declination: decl, eclipticLon };
  }

  function moonPosition(date, lat, lon, sun) {
    const J2000 = Date.UTC(2000, 0, 1, 12, 0, 0);
    const d = (date.getTime() - J2000) / 86400000;
    const L = (218.316 + 13.176396 * d) % 360;
    const M = (134.963 + 13.064993 * d) % 360;
    const F = (93.272 + 13.229350 * d) % 360;
    const lonEcl = (L + 6.289 * Math.sin(M * rad)) * rad;
    const latEcl = (5.128 * Math.sin(F * rad)) * rad;
    const obliquity = 23.439 * rad;

    const ra = Math.atan2(
      Math.sin(lonEcl) * Math.cos(obliquity) - Math.tan(latEcl) * Math.sin(obliquity),
      Math.cos(lonEcl)
    );
    const decl = Math.asin(
      Math.sin(latEcl) * Math.cos(obliquity) + Math.cos(latEcl) * Math.sin(obliquity) * Math.sin(lonEcl)
    );

    const gmst = (280.46061837 + 360.98564736629 * d) % 360;
    const lst = (gmst + lon) * rad;
    let hourAngle = lst - ra;
    hourAngle = ((hourAngle + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;

    const latRad = lat * rad;
    const altitude = Math.asin(
      Math.sin(latRad) * Math.sin(decl) + Math.cos(latRad) * Math.cos(decl) * Math.cos(hourAngle)
    );
    let azimuth = Math.atan2(
      -Math.sin(hourAngle),
      Math.tan(decl) * Math.cos(latRad) - Math.sin(latRad) * Math.cos(hourAngle)
    );
    azimuth = (azimuth + 2 * Math.PI) % (2 * Math.PI);

    const phaseAngle = Math.acos(_clamp(
      Math.sin(sun.declination) * Math.sin(decl) + Math.cos(sun.declination) * Math.cos(decl) * Math.cos(sun.eclipticLon - lonEcl),
      -1, 1
    ));
    const illumFraction = (1 + Math.cos(Math.PI - phaseAngle)) / 2;

    return { altitude, azimuth, illumFraction };
  }

  function toDirection(altitude, azimuth) {
    const cosAlt = Math.cos(altitude);
    const x = cosAlt * Math.sin(azimuth);
    const z = -cosAlt * Math.cos(azimuth);
    const y = Math.sin(altitude);
    return new THREE.Vector3(x, y, z).normalize();
  }

  return { sunPosition, moonPosition, toDirection };
})();

// ════════════════════════════════════════════════════════════════════════════════
// STAN CZASU — sterowany suwakiem "Godzina"/"Dzień roku" w panelu POGODA
// (lat/lon NIE jest tu trzymane — pobierane co klatkę z refLat/refLon,
//  czyli z aktualnie wybranego lotniska)
// ════════════════════════════════════════════════════════════════════════════════
const TimeState = {
  year: 2026,
  dayOfYear: 172,          // ~21 czerwca
  minutesOfDay: 720,       // 12:00
  animating: false,
  animMinutesPerSecond: 1, // nadpisywane przez UI (dw-anim-speed / w-anim-speed)
};

function getCurrentDate() {
  const d = new Date(Date.UTC(TimeState.year, 0, 1));
  d.setUTCDate(d.getUTCDate() + TimeState.dayOfYear - 1);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCMinutes(TimeState.minutesOfDay);
  return d;
}
function dayOfYearToDate(year, doy) {
  const d = new Date(Date.UTC(year, 0, 1));
  d.setUTCDate(d.getUTCDate() + doy - 1);
  return d;
}
function formatTimeHHMM(minutes) {
  const h = Math.floor(minutes / 60) % 24;
  const m = Math.floor(minutes % 60);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}
function formatDayOfYear(doy) {
  const d = dayOfYearToDate(TimeState.year, doy);
  const months = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
  return d.getUTCDate() + ' ' + months[d.getUTCMonth()];
}

// ════════════════════════════════════════════════════════════════════════════════
// SKY DOME — fizyczny Rayleigh + Mie scattering (kopuła śledząca kamerę)
// ════════════════════════════════════════════════════════════════════════════════
const skyUniforms = {
  sunDirection:  { value: new THREE.Vector3(0, 1, 0) },
  moonDirection: { value: new THREE.Vector3(0, -1, 0) },
  moonIllum:     { value: 0.5 },
  rayleighCoeff: { value: new THREE.Vector3(5.2e-6, 12.5e-6, 34.5e-6) },
  mieCoeff:      { value: 21e-6 },
  mieG:          { value: 0.76 },
  turbidity:     { value: 2.5 },
  exposure:      { value: 1.12 },
  sunIntensity:  { value: 25.0 },
  hazeAmount:    { value: 0.2 },
};

const SKY_DOME_VERT = `
varying vec3 vWorldPosition;
void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_DOME_FRAG = `
uniform vec3 sunDirection;
uniform vec3 moonDirection;
uniform float moonIllum;
uniform vec3 rayleighCoeff;
uniform float mieCoeff;
uniform float mieG;
uniform float turbidity;
uniform float exposure;
uniform float sunIntensity;
uniform float hazeAmount;
varying vec3 vWorldPosition;

#define PI 3.141592653589793
#define EARTH_RADIUS 6371000.0
#define ATMOS_RADIUS 6471000.0
#define NUM_SAMPLES 8
#define NUM_LIGHT_SAMPLES 4

const float RAYLEIGH_SCALE_H = 8000.0;
const float MIE_SCALE_H = 1200.0;

float atmosphereExit(vec3 ro, vec3 rd, float radius) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - radius*radius;
  float disc = b*b - c;
  if (disc < 0.0) return -1.0;
  float s = sqrt(disc);
  return -b + s;
}

vec3 computeSkyColor(vec3 rayDir, vec3 sunDir) {
  vec3 origin = vec3(0.0, EARTH_RADIUS + 1.0, 0.0);
  float tMax = atmosphereExit(origin, rayDir, ATMOS_RADIUS);
  if (tMax <= 0.0) return vec3(0.0);
  tMax = min(tMax, 220000.0);

  float segLen = tMax / float(NUM_SAMPLES);
  float tCurrent = 0.0;

  vec3 sumR = vec3(0.0);
  vec3 sumM = vec3(0.0);
  float opticalDepthR = 0.0;
  float opticalDepthM = 0.0;

  float mu = dot(rayDir, sunDir);
  float phaseR = 3.0 / (16.0 * PI) * (1.0 + mu*mu);
  float g2 = mieG*mieG;
  float phaseM = 3.0 / (8.0*PI) * ((1.0-g2)*(1.0+mu*mu)) / ((2.0+g2) * pow(max(1.0+g2-2.0*mieG*mu, 0.0001), 1.5));

  vec3 mieCoeffVec = vec3(mieCoeff) * turbidity;

  for (int i = 0; i < NUM_SAMPLES; i++) {
    vec3 samplePos = origin + rayDir * (tCurrent + segLen * 0.5);
    float height = length(samplePos) - EARTH_RADIUS;

    float hr = exp(-height / RAYLEIGH_SCALE_H) * segLen;
    float hm = exp(-height / MIE_SCALE_H) * segLen;
    opticalDepthR += hr;
    opticalDepthM += hm;

    float tLightMax = atmosphereExit(samplePos, sunDir, ATMOS_RADIUS);
    float segLenLight = tLightMax / float(NUM_LIGHT_SAMPLES);
    float tLight = 0.0;
    float opticalDepthLightR = 0.0;
    float opticalDepthLightM = 0.0;
    bool overground = true;

    for (int j = 0; j < NUM_LIGHT_SAMPLES; j++) {
      vec3 lightSamplePos = samplePos + sunDir * (tLight + segLenLight * 0.5);
      float lightHeight = length(lightSamplePos) - EARTH_RADIUS;
      if (lightHeight < 0.0) { overground = false; break; }
      opticalDepthLightR += exp(-lightHeight / RAYLEIGH_SCALE_H) * segLenLight;
      opticalDepthLightM += exp(-lightHeight / MIE_SCALE_H) * segLenLight;
      tLight += segLenLight;
    }

    if (overground) {
      vec3 tau = rayleighCoeff * (opticalDepthR + opticalDepthLightR) + mieCoeffVec * 1.1 * (opticalDepthM + opticalDepthLightM);
      vec3 attenuation = exp(-tau);
      sumR += attenuation * hr;
      sumM += attenuation * hm;
    }
    tCurrent += segLen;
  }

  vec3 result = (sumR * rayleighCoeff * phaseR + sumM * mieCoeffVec * phaseM) * sunIntensity;
  return result;
}

float starField(vec3 dir) {
  vec3 p = floor(dir * 400.0);
  float h = fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453);
  float star = step(0.9975, h);
  float twinkle = 0.7 + 0.3 * sin(h * 6283.0);
  return star * twinkle;
}

void main() {
  vec3 rayDir = normalize(vWorldPosition);
  if (rayDir.y < -0.04) rayDir.y = -0.04;
  rayDir = normalize(rayDir);

  vec3 sky = computeSkyColor(rayDir, sunDirection);

  float dayHazeFloor = clamp((sunDirection.y + 0.05) / 0.25, 0.0, 1.0);
  float lowAngleAmt = exp(-abs(rayDir.y) * 5.0);
  vec3 hazeFloorColor = vec3(0.55, 0.62, 0.7);
  sky = mix(sky, max(sky, hazeFloorColor * 0.6), lowAngleAmt * dayHazeFloor);

  float sunHeight = sunDirection.y;
  float duskBand = 1.0 - clamp(abs(sunHeight) / 0.30, 0.0, 1.0);
  float duskStrength = duskBand * duskBand * (3.0 - 2.0 * duskBand);
  float horizonGlow = exp(-abs(rayDir.y) * 6.0) * duskStrength;
  float sunProximity = pow(max(dot(rayDir, normalize(vec3(sunDirection.x, max(sunDirection.y,-0.05), sunDirection.z))), 0.0), 4.0);
  vec3 duskColor = vec3(1.0, 0.45, 0.15);
  sky += duskColor * horizonGlow * sunProximity * 1.8;
  sky += duskColor * 0.35 * horizonGlow;

  float nightFactor = smoothstep(0.05, -0.22, sunHeight);
  vec3 nightColor = mix(vec3(0.0), vec3(0.02,0.025,0.06), 1.0 - rayDir.y*0.5);

  float stars = starField(rayDir) * nightFactor * smoothstep(-0.05, 0.3, rayDir.y);
  nightColor += vec3(stars) * vec3(0.9,0.95,1.0);

  float moonDot = max(dot(rayDir, moonDirection), 0.0);
  vec3 moonGlow = vec3(0.3,0.34,0.42) * pow(moonDot, 600.0) * moonIllum * nightFactor * 0.8;
  nightColor += moonGlow;

  vec3 color = mix(sky, sky * 0.08 + nightColor, nightFactor);

  color *= exposure;
  color = color / (color + vec3(1.0));
  color = pow(color, vec3(1.0/2.2));

  gl_FragColor = vec4(color, 1.0);
}
`;

// Promień kopuły dopasowany do skali świata simworld (stara kopuła gradientowa
// też miała 900_000 — kamera.far = 2_000_000, więc mieścimy się z zapasem).
const SKY_DOME_RADIUS = 900000;
const skyGeo = new THREE.SphereGeometry(SKY_DOME_RADIUS, 32, 16);
const skyMat = new THREE.ShaderMaterial({
  uniforms: skyUniforms,
  vertexShader: SKY_DOME_VERT,
  fragmentShader: SKY_DOME_FRAG,
  side: THREE.BackSide,
  depthWrite: false,
  depthTest: false,
  fog: false,
});
const skyDome = new THREE.Mesh(skyGeo, skyMat);
skyDome.renderOrder = -100;
skyDome.frustumCulled = false;
scene.add(skyDome);

// ── Tarcze Słońca/Księżyca (billboard sprite + poświata) ──────────────────────
function makeSunTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(128,128,0,128,128,128);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.15, 'rgba(255,250,230,1)');
  grad.addColorStop(0.4, 'rgba(255,230,160,0.6)');
  grad.addColorStop(1, 'rgba(255,200,100,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0,0,256,256);
  return new THREE.CanvasTexture(c);
}
function makeMoonTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(128,128,0,128,128,128);
  grad.addColorStop(0, 'rgba(240,244,252,1)');
  grad.addColorStop(0.16, 'rgba(232,238,248,1)');
  grad.addColorStop(0.22, 'rgba(210,220,240,0.6)');
  grad.addColorStop(0.45, 'rgba(190,205,235,0.12)');
  grad.addColorStop(1, 'rgba(190,205,235,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0,0,256,256);
  return new THREE.CanvasTexture(c);
}

// Skala/dystans przeliczone proporcjonalnie z oryginalnej specyfikacji
// (SUN_DIST=18000, scale=1400) na skalę świata simworld (promień kopuły 900000),
// tak żeby kątowy rozmiar tarczy na ekranie pozostał identyczny.
const SUN_DIST = 800000;
const SUN_BASE_SCALE  = SUN_DIST * 1400 / 18000;
const MOON_BASE_SCALE = SUN_DIST * 140  / 18000;

const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
  map: makeSunTexture(), color: 0xffffff, transparent: true, depthWrite: false,
  blending: THREE.AdditiveBlending, fog: false,
}));
sunSprite.scale.set(SUN_BASE_SCALE, SUN_BASE_SCALE, 1);
scene.add(sunSprite);

const moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({
  map: makeMoonTexture(), color: 0xffffff, transparent: true, depthWrite: false,
  blending: THREE.AdditiveBlending, fog: false,
}));
moonSprite.scale.set(MOON_BASE_SCALE, MOON_BASE_SCALE, 1);
scene.add(moonSprite);

// ── Oświetlenie sceny (zastępuje statyczne sun/ambient/hemi z sim-scene.js) ───
const hemiLight = new THREE.HemisphereLight(0x88aaff, 0x3a5a2c, 0.6);
scene.add(hemiLight);
const sunLight = new THREE.DirectionalLight(0xffffff, 1.0);
sunLight.position.set(100, 100, 0);
scene.add(sunLight);

// ════════════════════════════════════════════════════════════════════════════════════
// GŁÓWNA SCENA → RENDER TARGET Z BUFOREM GŁĘBI
// Renderujemy scenę (teren, budynki, samolot, deszcz, gwiazdy, kopułę nieba)
// do offscreen render targetu zamiast bezpośrednio na ekran. Bufor głębi z
// tego przejścia (mainDepthTexture) jest potem używany przez raymarching chmur,
// żeby chmurom NIE renderowały się "przed" rzeczami, które powinny je
// zasłaniać (góry, teren, samolot) — bez tego kroku chmury były zwykłym
// kompozytem na wierzchu całej sceny, bez żadnego testu głębokości.
// ════════════════════════════════════════════════════════════════════════════════════
const mainDepthTexture = new THREE.DepthTexture();
mainDepthTexture.format = THREE.DepthFormat;
mainDepthTexture.type   = THREE.UnsignedIntType;
mainDepthTexture.minFilter = THREE.NearestFilter;
mainDepthTexture.magFilter = THREE.NearestFilter;

const mainRT = new THREE.WebGLRenderTarget(1, 1, {
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  format: THREE.RGBAFormat,
  type: THREE.UnsignedByteType,
  depthBuffer: true,
  depthTexture: mainDepthTexture,
});

function resizeMainRT() {
  const w = renderer.domElement.width  || window.innerWidth;
  const h = renderer.domElement.height || window.innerHeight;
  mainRT.setSize(w, h);
}
resizeMainRT();
window.addEventListener('resize', resizeMainRT);

// Pełnoekranowy quad, który po prostu wyświetla obraz z mainRT — używany w
// renderFrame() jako "tło", na którym potem kładziemy chmury.
const bgMat = new THREE.ShaderMaterial({
  uniforms: { tScene: { value: mainRT.texture } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tScene;
    varying vec2 vUv;
    void main() { gl_FragColor = texture2D(tScene, vUv); }
  `,
  depthWrite: false, depthTest: false,
});
const bgQuad = new THREE.Mesh(new THREE.PlaneGeometry(2,2), bgMat);
bgQuad.frustumCulled = false;
const bgScene = new THREE.Scene();
bgScene.add(bgQuad);

// ════════════════════════════════════════════════════════════════════════════════
// CHMURY WOLUMETRYCZNE — raymarching, renderowane do osobnego render targetu
// (niska rozdzielczość wg presetu jakości) i kompozytowane na wierzch sceny.
// ════════════════════════════════════════════════════════════════════════════════
const cloudUniforms = {
  cameraPos:            { value: new THREE.Vector3() },
  invProjectionMatrix:  { value: new THREE.Matrix4() },
  invViewMatrix:        { value: new THREE.Matrix4() },
  sunDirection:         { value: new THREE.Vector3(0,1,0) },
  time:                 { value: 0 },
  cloudCover:           { value: 0.4 },
  cloudBase:            { value: 1500.0 },
  cloudThickness:       { value: 900.0 },
  windOffset:           { value: new THREE.Vector2(0,0) },
  windTurbulence:       { value: 0.3 },
  sunColor:             { value: new THREE.Color(0xffffff) },
  nightFactor:          { value: 0.0 },
  cloudLightFactor:     { value: 1.0 },
  horizonColor:         { value: new THREE.Color(0xbcd2ef) },
  raySteps:             { value: 48 },
  lightSteps:           { value: 5 },
  resolution:           { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
  // Do okluzji chmur względem rzeczywistej geometrii sceny (góry/teren/samolot) —
  // patrz mainDepthTexture wyżej i CLOUD_VOL_FRAG niżej.
  sceneDepth:           { value: mainDepthTexture },
  cameraForward:        { value: new THREE.Vector3(0, 0, -1) },
  logDepthBufFC:        { value: 0 },
};

const CLOUD_VOL_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const CLOUD_VOL_FRAG = `
precision highp float;
varying vec2 vUv;

uniform vec3 cameraPos;
uniform mat4 invProjectionMatrix;
uniform mat4 invViewMatrix;
uniform vec3 sunDirection;
uniform float time;
uniform float cloudCover;
uniform float cloudBase;
uniform float cloudThickness;
uniform vec2 windOffset;
uniform float windTurbulence;
uniform vec3 sunColor;
uniform float nightFactor;
uniform float cloudLightFactor;
uniform vec3 horizonColor;
uniform int raySteps;
uniform int lightSteps;
uniform vec2 resolution;
uniform sampler2D sceneDepth;
uniform vec3 cameraForward;
uniform float logDepthBufFC;

#define PI 3.141592653589793

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise3(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f*f*(3.0-2.0*f);
  return mix(
    mix(mix(hash(i+vec3(0,0,0)), hash(i+vec3(1,0,0)), f.x),
        mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
    mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x),
        mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y),
    f.z);
}
float fbm(vec3 p, int octaves) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    v += a * noise3(p);
    p *= 2.02;
    a *= 0.5;
  }
  return v;
}

float cloudDensity(vec3 p, float heightFrac) {
  vec3 wp = p * 0.00018 + vec3(windOffset.x, 0.0, windOffset.y) * 0.0001;

  float coverage = fbm(wp * 1.0 + vec3(0.0, time*0.003, 0.0), 5);
  float threshold = mix(0.78, 0.18, cloudCover);
  coverage = (coverage - threshold) / max(1.0 - threshold, 0.05);
  if (coverage <= 0.0) return 0.0;
  coverage = min(coverage, 1.0);

  float bottomFade = smoothstep(0.0, 0.15, heightFrac);
  float topFade = smoothstep(1.0, 0.55, heightFrac);
  float heightShape = bottomFade * topFade;
  if (heightShape <= 0.001) return 0.0;

  vec3 detailP = wp * 4.5 + vec3(windOffset.x, time*0.02, windOffset.y) * 0.0006 * (1.0+windTurbulence);
  float detail = fbm(detailP, 4);

  float density = coverage * heightShape;
  density -= detail * 0.22 * heightShape;
  density = clamp(density, 0.0, 1.0);
  density = pow(density, 1.3 - heightFrac*0.4);
  return density;
}

float phaseHG(float cosAngle, float g) {
  float g2 = g*g;
  return (1.0 - g2) / (4.0*PI*pow(max(1.0+g2-2.0*g*cosAngle,0.0001), 1.5));
}

// Odwraca logarytmiczny bufor głębokości (renderer używa
// logarithmicDepthBuffer:true, więc standardowa formuła perspektywiczna byłaby
// błędna) na "liniową" odległość wzdłuż osi patrzenia kamery — dokładnie
// odwrotność tego, co three.js sam liczy przy zapisie do gl_FragDepth.
float logDepthToViewDist(float d) {
  return pow(2.0, d * 2.0 / logDepthBufFC) - 1.0;
}

float lightMarch(vec3 p, vec3 sunDir, float heightFrac) {
  float stepSize = cloudThickness / float(lightSteps) * 0.5;
  float density = 0.0;
  vec3 pos = p;
  for (int i = 0; i < 6; i++) {
    if (i >= lightSteps) break;
    pos += sunDir * stepSize;
    float hf = clamp((pos.y - cloudBase) / cloudThickness, 0.0, 1.0);
    density += cloudDensity(pos, hf) * stepSize;
  }
  return exp(-density * 0.0018);
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec4 clipPos = vec4(ndc, -1.0, 1.0);
  vec4 viewPos = invProjectionMatrix * clipPos;
  viewPos = vec4(viewPos.xy, -1.0, 0.0);
  vec3 rayDir = normalize((invViewMatrix * viewPos).xyz);

  if (abs(rayDir.y) < 0.0008) {
    gl_FragColor = vec4(0.0);
    return;
  }

  float tBase = (cloudBase - cameraPos.y) / rayDir.y;
  float tTop = (cloudBase + cloudThickness - cameraPos.y) / rayDir.y;
  float tNear = max(min(tBase, tTop), 0.0);
  float tFar = max(tBase, tTop);
  if (tFar <= tNear) { gl_FragColor = vec4(0.0); return; }

  // Nie pozwól chmurze "przebić się" przez rzeczywistą geometrię sceny w tym
  // pikselu (góry, teren, samolot) — obetnij zasięg raymarchingu do
  // odległości najbliższego nieprzezroczystego obiektu z głównego renderu.
  float depthSample = texture2D(sceneDepth, vUv).x;
  float sceneViewDist = logDepthToViewDist(depthSample);
  float cosFwd = max(dot(rayDir, cameraForward), 0.0001);
  float sceneRayDist = sceneViewDist / cosFwd;
  tFar = min(tFar, sceneRayDist);
  if (tFar <= tNear) { gl_FragColor = vec4(0.0); return; }

  float maxDist = 60000.0;
  tFar = min(tFar, tNear + maxDist);

  float stepCount = float(raySteps);
  float stepSize = (tFar - tNear) / stepCount;
  float t = tNear + stepSize * 0.5;

  vec3 colorAccum = vec3(0.0);
  float densityWeightSum = 0.0;
  float alpha = 0.0;
  float cosAngle = dot(rayDir, sunDirection);
  float phase = mix(phaseHG(cosAngle, 0.6), phaseHG(cosAngle, -0.2), 0.3) * 1.5 + 0.15;

  vec3 sunLitColor = sunColor * mix(0.4, 2.0, cloudLightFactor);
  vec3 ambientSky = mix(horizonColor * 1.7, vec3(0.14,0.15,0.19), nightFactor * 0.7);
  ambientSky = max(ambientSky, vec3(0.28,0.29,0.33));

  for (int i = 0; i < 64; i++) {
    if (i >= raySteps) break;
    if (alpha >= 0.985) break;
    vec3 p = cameraPos + rayDir * t;
    float heightFrac = clamp((p.y - cloudBase) / cloudThickness, 0.0, 1.0);
    float density = cloudDensity(p, heightFrac);

    if (density > 0.005) {
      float shadow = lightMarch(p, sunDirection, heightFrac);
      float shadowMod = mix(0.7, 1.0, shadow);
      vec3 litColor = ambientSky + sunLitColor * shadowMod * phase * 0.4;
      float extinction = exp(-density * stepSize * 0.014);
      float absorb = 1.0 - extinction;

      colorAccum += litColor * absorb;
      densityWeightSum += absorb;
      alpha += absorb * (1.0 - alpha);
    }
    t += stepSize;
  }

  vec3 col = densityWeightSum > 0.0001 ? (colorAccum / densityWeightSum) : vec3(0.0);

  float dist = tNear;
  float distFade = exp(-dist * 0.000022);
  alpha *= distFade;

  gl_FragColor = vec4(col, alpha);
}
`;

const cloudMat = new THREE.ShaderMaterial({
  uniforms: cloudUniforms,
  vertexShader: CLOUD_VOL_VERT,
  fragmentShader: CLOUD_VOL_FRAG,
  transparent: true,
  depthWrite: false,
  depthTest: false,
});
const cloudQuad = new THREE.Mesh(new THREE.PlaneGeometry(2,2), cloudMat);
cloudQuad.frustumCulled = false;
const cloudScene = new THREE.Scene();
cloudScene.add(cloudQuad);
const cloudCamera = new THREE.Camera();

const QualityPresets = {
  low:  { scale: 0.15, raySteps: 8, lightSteps: 1 },
  med:  { scale: 0.55, raySteps: 40, lightSteps: 4 },
  high: { scale: 0.85, raySteps: 64, lightSteps: 6 },
};
let currentQuality = 'low';

let cloudRT = new THREE.WebGLRenderTarget(1, 1, {
  minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
});

const compositeMat = new THREE.ShaderMaterial({
  uniforms: { tCloud: { value: cloudRT.texture } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy,0.0,1.0); }`,
  fragmentShader: `
    uniform sampler2D tCloud;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tCloud, vUv);
      vec3 unpremult = c.a > 0.001 ? c.rgb / c.a : vec3(0.0);
      gl_FragColor = vec4(unpremult, c.a);
    }
  `,
  transparent: true, depthWrite: false, depthTest: false,
});
const compositeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2,2), compositeMat);
compositeQuad.frustumCulled = false;
const compositeScene = new THREE.Scene();
compositeScene.add(compositeQuad);

function resizeCloudRT() {
  const q = QualityPresets[currentQuality];
  const w = Math.max(1, Math.floor(window.innerWidth * q.scale));
  const h = Math.max(1, Math.floor(window.innerHeight * q.scale));
  cloudRT.setSize(w, h);
  cloudUniforms.raySteps.value = q.raySteps;
  cloudUniforms.lightSteps.value = q.lightSteps;
  cloudUniforms.resolution.value.set(w, h);
}
resizeCloudRT();
window.addEventListener('resize', resizeCloudRT);

// Wybór jakości z UI (przyciski [data-qual] w panelu POGODA, dw-/w- wspólne)
function setSkyQuality(name) {
  if (!QualityPresets[name]) return;
  currentQuality = name;
  resizeCloudRT();
  document.querySelectorAll('[data-qual]').forEach(b => {
    b.classList.toggle('active', b.dataset.qual === name);
  });
}

function updateCloudUniforms() {
  cloudUniforms.cameraPos.value.copy(camera.position);
  cloudUniforms.invProjectionMatrix.value.copy(camera.projectionMatrixInverse);
  cloudUniforms.invViewMatrix.value.copy(camera.matrixWorld);
  camera.getWorldDirection(cloudUniforms.cameraForward.value);
  cloudUniforms.logDepthBufFC.value = 2.0 / Math.log2(camera.far + 1.0);
}

// Cały potok renderowania klatki, wołany raz na klatkę z sim-main.js zamiast
// bezpośredniego renderer.render(scene, camera):
//   1) Główna scena → mainRT (z buforem głębi, potrzebnym w kroku 2).
//   2) Chmury wolumetryczne → cloudRT, w obniżonej rozdzielczości wg presetu
//      jakości, z użyciem mainRT.depthTexture do przycinania zasięgu
//      raymarchingu do rzeczywistej geometrii sceny (góry/teren/samolot).
//   3) Złożenie końcowej klatki na ekranie: najpierw obraz z kroku 1 (tło),
//      potem chmury z kroku 2 na wierzchu (poprawny blending alfa).
function renderFrame() {
  renderer.setRenderTarget(mainRT);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);

  updateCloudUniforms();
  const prevClearColor = new THREE.Color();
  renderer.getClearColor(prevClearColor);
  const prevClearAlpha = renderer.getClearAlpha();

  renderer.setRenderTarget(cloudRT);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(cloudScene, cloudCamera);
  renderer.setRenderTarget(null);

  renderer.setClearColor(prevClearColor, prevClearAlpha);

  renderer.autoClear = true;
  renderer.render(bgScene, cloudCamera);
  renderer.autoClear = false;
  renderer.render(compositeScene, cloudCamera);
  renderer.autoClear = true;
}

// ════════════════════════════════════════════════════════════════════════════════
// DESZCZ — smugi kierunkowe (głowa+ogon), reagujące na wiatr ORAZ prędkość
// samolotu (apparent velocity) — w stylu X-Plane 10, identycznie jak w
// poprzedniej wersji systemu pogody (zachowane 1:1, bo dobrze skalibrowane).
// ════════════════════════════════════════════════════════════════════════════════
const RAIN_LINE_VERT = `
attribute float aT;
varying float vT;
void main() {
  vT = aT;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const RAIN_LINE_FRAG = `
uniform float uIntensity;
varying float vT;
void main() {
  float alpha = mix(0.80, 0.02, vT) * uIntensity;
  gl_FragColor = vec4(0.84, 0.94, 1.00, alpha);
}
`;

const RAIN_N = 1800;
const RAIN_R = 220;
let _rainGeo, _rainMesh;

function initRain() {
  const pos = new Float32Array(RAIN_N * 2 * 3);
  const aT  = new Float32Array(RAIN_N * 2);

  for (let i = 0; i < RAIN_N; i++) {
    const r = Math.random() * RAIN_R, a = Math.random() * Math.PI * 2;
    const hx = Math.cos(a) * r, hy = Math.random() * 120 - 20, hz = Math.sin(a) * r;
    pos[(i*2)*3+0] = hx;   pos[(i*2)*3+1] = hy;   pos[(i*2)*3+2] = hz;
    pos[(i*2+1)*3+0] = hx; pos[(i*2+1)*3+1] = hy+2; pos[(i*2+1)*3+2] = hz;
    aT[i*2] = 0.0; aT[i*2+1] = 1.0;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
  _rainGeo = geo;

  const mat = new THREE.ShaderMaterial({
    vertexShader: RAIN_LINE_VERT,
    fragmentShader: RAIN_LINE_FRAG,
    transparent: true, depthWrite: false, depthTest: false, fog: false,
    uniforms: { uIntensity: { value: 0 } },
  });
  _rainMesh = new THREE.LineSegments(geo, mat);
  _rainMesh.frustumCulled = false;
  _rainMesh.renderOrder = 200;
}
initRain();

function updateRain(dt, camPos) {
  const active = WeatherState.precipitation;
  if (active && !_rainMesh.parent) scene.add(_rainMesh);
  if (!active && _rainMesh.parent) scene.remove(_rainMesh);
  if (!active) return;

  const ac = activeEntity;
  const ac_vx = ac ? ac.vel.x : 0;
  const ac_vy = ac ? ac.vel.y * Y_SCALE : 0;
  const ac_vz = ac ? ac.vel.z : 0;
  const ww = weather ? weather.windWorld : { x: 0, z: 0 };

  const FALL = (7 + WeatherState.precipIntensity * 5) * Y_SCALE;
  const rvx = (ww.x - ac_vx) * dt;
  const rvy = -(FALL + ac_vy) * dt;
  const rvz = (ww.z - ac_vz) * dt;

  const spd = Math.sqrt(rvx*rvx + rvy*rvy + rvz*rvz);
  const dnx = spd > 0.001 ? rvx/spd : 0;
  const dny = spd > 0.001 ? rvy/spd : -1;
  const dnz = spd > 0.001 ? rvz/spd : 0;

  const streakLen = Math.min(2 + WeatherState.precipIntensity*2 + spd*16, 45.0);

  _rainMesh.material.uniforms.uIntensity.value = WeatherState.precipIntensity;
  _rainMesh.position.copy(camPos);

  const pos = _rainGeo.attributes.position;
  for (let i = 0; i < RAIN_N; i++) {
    let hx = pos.getX(i*2), hy = pos.getY(i*2), hz = pos.getZ(i*2);
    hx += rvx; hy += rvy; hz += rvz;

    if (hy < -60 || hx*hx + hz*hz > RAIN_R*RAIN_R) {
      const r = Math.random()*RAIN_R, a = Math.random()*Math.PI*2;
      hx = Math.cos(a)*r; hy = 90+Math.random()*50; hz = Math.sin(a)*r;
    }
    pos.setXYZ(i*2, hx, hy, hz);
    pos.setXYZ(i*2+1, hx-dnx*streakLen, hy-dny*streakLen, hz-dnz*streakLen);
  }
  pos.needsUpdate = true;
}

// ════════════════════════════════════════════════════════════════════════════════
// GŁÓWNA AKTUALIZACJA — wołana co klatkę z sim-main.js (PRZED renderer.render)
// ════════════════════════════════════════════════════════════════════════════════
const sunWorldDir = new THREE.Vector3();
const moonWorldDir = new THREE.Vector3();

function updateSky(dt) {
  if (TimeState.animating) {
    TimeState.minutesOfDay += dt * TimeState.animMinutesPerSecond;
    if (TimeState.minutesOfDay >= 1440) {
      TimeState.minutesOfDay -= 1440;
      TimeState.dayOfYear = (TimeState.dayOfYear % 365) + 1;
    }
    if (typeof weatherUI !== 'undefined' && weatherUI.syncSkyUI) weatherUI.syncSkyUI();
  }

  const date = getCurrentDate();
  const sunPos = Astro.sunPosition(date, refLat, refLon);
  const moonPos = Astro.moonPosition(date, refLat, refLon, sunPos);

  sunWorldDir.copy(Astro.toDirection(sunPos.altitude, sunPos.azimuth));
  moonWorldDir.copy(Astro.toDirection(moonPos.altitude, moonPos.azimuth));

  skyUniforms.sunDirection.value.copy(sunWorldDir);
  skyUniforms.moonDirection.value.copy(moonWorldDir);
  skyUniforms.moonIllum.value = moonPos.illumFraction;

  // Mgła/widoczność (WeatherState.visibilityM) → mętność atmosfery (turbidity).
  // Krzywa dobrana tak, by dobra widzialność (~20 km, domyślny stan) dawała
  // PRAWIE zerowe zamglenie — wcześniejsza wersja robiła niebo wyraźnie
  // zamżlone/brązowawe nawet w "czystych" warunkach. Pełne zamglenie dopiero
  // przy słabej widzialności (deszcz/mgła/burza, poniżej ~2 km).
  const vis = WeatherState.visibilityM;
  const hazeT = _clamp((20000 - vis) / 18000, 0, 1);
  skyUniforms.turbidity.value = _lerp(1.6, 9.0, hazeT);
  skyUniforms.hazeAmount.value = hazeT;

  skyDome.position.copy(camera.position);

  sunSprite.position.copy(sunWorldDir).multiplyScalar(SUN_DIST);
  moonSprite.position.copy(moonWorldDir).multiplyScalar(SUN_DIST);

  const sunAlt = sunPos.altitude;
  const sunFade = _clamp((sunAlt + 0.05) / 0.1, 0, 1);
  sunSprite.material.opacity = sunFade;
  const horizonBoost = 1.0 + 0.6 * Math.max(0, 1 - Math.abs(sunAlt) / 0.15);
  sunSprite.scale.set(SUN_BASE_SCALE*horizonBoost, SUN_BASE_SCALE*horizonBoost, 1);

  const moonFade = _clamp((moonPos.altitude + 0.05)/0.1, 0, 1) * Math.min(1, moonPos.illumFraction*1.5+0.2);
  moonSprite.material.opacity = moonFade;

  let sunColorObj;
  if (sunAlt > 0.25) sunColorObj = new THREE.Color(0xfff6e8);
  else if (sunAlt > 0.0) { const tt = sunAlt/0.25; sunColorObj = new THREE.Color(0xff8c42).lerp(new THREE.Color(0xfff6e8), tt); }
  else sunColorObj = new THREE.Color(0xff5e2c);
  sunSprite.material.color.copy(sunColorObj);

  const dayFactor = _clamp((sunAlt+0.1)/0.3, 0, 1);
  sunLight.intensity = _lerp(0.05, 1.35, dayFactor);
  sunLight.color.copy(sunColorObj);
  sunLight.position.copy(sunWorldDir).multiplyScalar(1000);
  sunLight.position.y = Math.max(sunLight.position.y, 5);

  const nightFactor = 1 - dayFactor;
  const moonLightStrength = nightFactor * Math.max(0, moonPos.altitude) * moonPos.illumFraction * 0.15;

  const skyTint = sunAlt > 0
    ? new THREE.Color().lerpColors(new THREE.Color(0xffb066), new THREE.Color(0xaecbff), Math.min(sunAlt/0.5,1))
    : new THREE.Color(0x0a1530);
  hemiLight.color.copy(skyTint);
  hemiLight.intensity = _lerp(0.12, 0.75, dayFactor) + moonLightStrength;
  hemiLight.groundColor.set(0x2a3a20).lerp(new THREE.Color(0x05070d), nightFactor*0.8);

  let horizonColor = sunAlt > 0.12 ? new THREE.Color(0xbcd2ef)
    : sunAlt > -0.04 ? new THREE.Color().lerpColors(new THREE.Color(0xff9d5c), new THREE.Color(0xbcd2ef), Math.max(0,sunAlt)/0.12)
    : sunAlt > -0.21 ? new THREE.Color().lerpColors(new THREE.Color(0x16213a), new THREE.Color(0xff9d5c), Math.max(0,(sunAlt+0.21))/0.17)
    : new THREE.Color(0x070b18);

  // Zamglenie (hazeT) rozjaśnia/wybiela horyzont — bez tego płaski kolor mgły
  // sceny nie pasował do fizycznie zamglonej kopuły nieba (wyższa turbidity =
  // jaśniejszy, bielszy horyzont w shaderze), co dawało widoczny szew dokładnie
  // na linii horyzontu — tym bardziej widoczny przy oddalonej kamerze, bo wtedy
  // większość kadru to właśnie zamglony teren/horyzont.
  horizonColor = horizonColor.lerp(new THREE.Color(0x9eacb3), hazeT * 0.7);

  // Mgła sceny — kolor z horyzontu nieba. Zasięg liczony z WeatherState.visibilityM,
  // ale z zapasem (×1.5) — sama liczba "widzialności" meteorologicznej to dolna
  // granica tego, co jeszcze widać WYRAŹNIE; twardy fog dokładnie na tej
  // odległości wyglądał na zbyt krótki/klaustrofobiczny. W chmurze używamy
  // weather.cloudImmersion (płynne, zależne od zachmurzenia zanurzenie w
  // paśmie wysokości chmur) — to samo źródło prawdy, którego używa też
  // mgiełka 2D w sim-weather.js, żeby oba efekty były ze sobą spójne.
  const clearFogFar = vis * 1.5;
  const immersion   = weather ? weather.cloudImmersion : 0;
  const inCloudFar   = Math.max(250, vis * 0.05);
  const fogFar = immersion > 0 ? _lerp(clearFogFar, inCloudFar, Math.min(1, immersion)) : clearFogFar;
  scene.fog.far = fogFar;
  scene.fog.near = scene.fog.far * 0.2;
  scene.fog.color.copy(horizonColor);
  renderer.setClearColor(horizonColor);

  // Chmury wolumetryczne — wysokość w world-space skalowana tak samo jak
  // teren i samolot (DEM_EXAG * Y_SCALE), inaczej chmury nie zgadzałyby się
  // wizualnie z wysokościomierzem / logiką WeatherState.isInCloud.
  const coverPct = WeatherState.cloudCoverage;
  cloudUniforms.cloudCover.value = coverPct;
  cloudUniforms.cloudBase.value = WeatherState.cloudAltitudeM * DEM_EXAG * Y_SCALE;
  cloudUniforms.cloudThickness.value = _lerp(300, 1400, Math.min(coverPct*1.5, 1)) * DEM_EXAG * Y_SCALE;
  cloudUniforms.sunColor.value.copy(sunColorObj);
  cloudUniforms.nightFactor.value = nightFactor;
  cloudUniforms.sunDirection.value.copy(sunWorldDir);
  cloudUniforms.cloudLightFactor.value = _clamp((sunAlt+0.22)/0.42, 0, 1);
  cloudUniforms.horizonColor.value.copy(horizonColor);
  cloudUniforms.windTurbulence.value = WeatherState.turbulence;

  const windDrift = Math.min(1, WeatherState.windSpeedMs / 30);
  cloudUniforms.time.value += dt;
  cloudUniforms.windOffset.value.x += dt * (8 + windDrift*25);
  cloudUniforms.windOffset.value.y += dt * (4 + windDrift*15);

  updateRain(dt, camera.position);
}
