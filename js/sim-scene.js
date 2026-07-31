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
// Tło i oświetlenie przejmuje w 100% sim-sky.js (fizyczna kopuła nieba +
// Słońce/Księżyc + światła zależne od pory dnia) — dlatego tutaj scena nie
// dostaje już ani statycznego koloru tła, ani stałych świateł.
scene.background = null;
scene.fog        = new THREE.Fog(0x9fc3e6, 60_000, 400_000);

// ── Kamera perspektywiczna ─────────────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.2, 2_000_000);

// ── Resize ────────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
