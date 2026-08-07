'use strict';

// Renderer
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

// Scene
const scene = new THREE.Scene();
// Configure scene.background.
scene.background = null;
scene.fog        = new THREE.Fog(0x9fc3e6, 60_000, 400_000);

// Camera
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.2, 2_000_000);

// Resize
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
