'use strict';

// ── Pętla renderowania ─────────────────────────────────────────────────────────

const exhaust = new ExhaustParticles();
let fc = 0, lastRenderT = performance.now();

function animate(t) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (t - lastRenderT) / 1000);
  lastRenderT = t; fc++;

  updatePlaneInput();
  physicsTick(t);

  updateOrbitKeyboard(dt);
  applyJoystick(dt);
  applyZoomButtons(dt);

  applyCamera(dt);

  const trackLat  = activeEntity ? activeEntity.lat : orb.lat;
  const trackLon  = activeEntity ? activeEntity.lon : orb.lon;
  const trackDist = cameraGroundDistanceM(orb.dist);

  if (fc % 2  === 0) updateTiles(trackLat, trackLon, trackDist);
  if (fc % 10 === 0) loadBuildings(trackLat, trackLon, trackDist);

  for (const e of entities.values()) {
    e.syncMesh();
    e.renderUpdate(dt);
  }

  if (activeEntity) emitExhaust(activeEntity, exhaust);
  exhaust.update(dt);

  if (fc % 3 === 0) updateHUD();
  if (fc % 2 === 0 && weather) weather.update(dt, camera.position, activeEntity ? activeEntity.altM : 0);

  renderer.render(scene, camera);
}

// ── Start ────────────────────────────────────────────────────────────────────

const loadbar = document.getElementById('loadbar');
let loadProg = 0;
const loadInterval = setInterval(() => {
  loadProg = Math.min(95, loadProg + Math.random() * 14 + 5);
  loadbar.style.width = loadProg + '%';
}, 150);

(async function init() {
  try {
    await Promise.all([
      prefetchDEM(SPAWN_LAT, SPAWN_LON, 2, 17),
      prefetchDEM(SPAWN_LAT, SPAWN_LON, 3, 15),
      prefetchDEM(SPAWN_LAT, SPAWN_LON, 4, 13),
      prefetchDEM(SPAWN_LAT, SPAWN_LON, 5, 11),
      prefetchDEM(SPAWN_LAT, SPAWN_LON, 6,  9),
    ]);
  } catch (e) { console.error('[init] DEM prefetch failed', e); }

  const plane = new A321Entity({ id: 'a321' });
  plane.reset({});
  scene.add(plane.mesh);
  addEntity(plane);
  activeEntity = plane;

  applyCamera(0);
  const initialGroundDist = cameraGroundDistanceM(orb.dist);
  updateTiles(SPAWN_LAT, SPAWN_LON, initialGroundDist);
  loadBuildings(SPAWN_LAT, SPAWN_LON, initialGroundDist);
  updateCameraHUD();

  clearInterval(loadInterval);
  loadbar.style.width = '100%';
  setTimeout(() => {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('hud').style.display = 'block';

    // Wykryj prawdziwy ekran dotykowy (wyklucz PC z touchscreen przez sprawdzenie
    // czy urządzenie ma mysz — pointer:fine = mysz, pointer:coarse = palec)
    const hasFinePointer = matchMedia('(pointer:fine)').matches;
    const hasTouchEvents = navigator.maxTouchPoints > 0;
    const isRealMobile   = hasTouchEvents && !hasFinePointer;
    if (isRealMobile) {
      document.body.classList.add('is-touch');
    }
    setInterval(() => {
      if (activeEntity) {
        const la = activeEntity.lat, lo = activeEntity.lon;
        prefetchDEM(la, lo, 2, 17);
        prefetchDEM(la, lo, 3, 15);
        prefetchDEM(la, lo, 4, 13);
        prefetchDEM(la, lo, 5, 11);
      }
    }, 800);
    // Inicjalizacja pogody
    weather = new WeatherSystem();
    weatherUI.init();
    weatherUI.syncUI();

    lastRenderT = performance.now();
    animate(lastRenderT);
  }, 400);
})();
