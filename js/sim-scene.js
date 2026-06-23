'use strict';

// ── Renderer ──────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({
  canvas: document.getElementById('c'),
  antialias: true,
  logarithmicDepthBuffer: true,
  powerPreference: 'high-performance',
});
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.toneMapping        = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

// ── Scena ─────────────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fc3e6);
scene.fog        = new THREE.Fog(0x9fc3e6, 60_000, 400_000);

// ── Kamera perspektywiczna ─────────────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.5, 2_000_000);

// ── Niebo (shader gradient) ───────────────────────────────────────────────────
(function buildSky() {
  const skyGeo = new THREE.SphereGeometry(900_000, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      topColor:   { value: new THREE.Color(0x0d2a6b) },
      horizColor: { value: new THREE.Color(0x9fc3e6) },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 horizColor;
      varying vec3 vWorldPos;
      void main() {
        float h = normalize(vWorldPos).y;
        float t = max(0.0, min(1.0, pow(max(h + 0.05, 0.0), 0.45)));
        gl_FragColor = vec4(mix(horizColor, topColor, t), 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
})();

// ── Oświetlenie ───────────────────────────────────────────────────────────────
const sun = new THREE.DirectionalLight(0xfff0d8, 1.6);
sun.position.set(100_000, 150_000, 80_000);
scene.add(sun);
scene.add(new THREE.AmbientLight(0xffffff, 0.85));
scene.add(new THREE.HemisphereLight(0x9fc3e6, 0x33442a, 0.35));

// ── Resize ────────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
