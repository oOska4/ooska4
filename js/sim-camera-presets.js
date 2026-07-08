'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// CAMERA PRESETS — Gotowe sekwencje do trailera i demonstracji
// ═══════════════════════════════════════════════════════════════════════════════
// Wkleić do konsoli lub dodać do sim-main.js
// Użycie: runCameraPreset('cinematic_close');

const CameraPresets = {
  
  // Scena wprowadzenia — Flyby z dużej odległości
  intro_flyby: {
    setup() {
      setCameraMode(CameraMode.FLYBY);
      setFlybySpeed(30);  // powolny, epicki ruch
      setFlybyRadius(250);  // daleka kamera
      flybyCamera.heightOffset = 60;  // wysoka perspektywa
      console.log('📹 Preset: Intro Flyby (30°/s, 250m)');
    },
    duration: 8000  // 8 sekund
  },

  // Blisk cinematic z autozooma
  cinematic_close: {
    setup() {
      setCameraMode(CameraMode.CINEMATIC);
      setCinematicTargetDistance(70);
      setCinematicHeightAbove(120);
      toggleCinematicAutoZoom();
      console.log('📹 Preset: Cinematic Close-up (autozooma aktywna)');
    },
    duration: 6000
  },

  // Dynamiczny flyby dla akcji
  action_flyby: {
    setup() {
      setCameraMode(CameraMode.FLYBY);
      setFlybySpeed(60);  // szybkie obroty
      setFlybyRadius(180);  // bliżej
      flybyCamera.heightOffset = 30;  // niska perspektywa — dramatycznie
      console.log('📹 Preset: Action Flyby (60°/s, 180m)');
    },
    duration: 5000
  },

  // Elegancki dolly zoom
  dolly_elegant: {
    setup() {
      setCameraMode(CameraMode.DOLLY);
      setDollySpeed(15);  // powolna, elegancka
      setDollyRadius(200);
      toggleDollyAutoZoom();
      console.log('📹 Preset: Dolly Elegant (15°/s, dolly zoom ON)');
    },
    duration: 10000
  },

  // Wieża obserwacyjna — całość widoku
  tower_overview: {
    setup() {
      setCameraMode(CameraMode.TOWER);
      setTowerHeight(600);
      toggleTowerTracking();  // śledzenie samolotu
      console.log('📹 Preset: Tower Overview (600m height, tracking ON)');
    },
    duration: 7000
  },

  // Custom slowmo flyby
  slowmo_flyby: {
    setup() {
      setCameraMode(CameraMode.FLYBY);
      setFlybySpeed(15);  // bardzo powolna
      setFlybyRadius(300);  // daleka perspektywa
      console.log('📹 Preset: Slowmo Flyby (15°/s, 300m) - idealna do slowmo');
    },
    duration: 15000
  },

  // Cockpit na koniec
  cockpit_immersion: {
    setup() {
      setCameraMode(CameraMode.COCKPIT);
      console.log('📹 Preset: Cockpit Immersion (pilot POV)');
    },
    duration: 5000
  },

  // High altitude overview
  eagle_view: {
    setup() {
      setCameraMode(CameraMode.TOWER);
      setTowerHeight(1200);  // bardzo wysoko
      toggleTowerTracking();
      console.log('📹 Preset: Eagle View (1200m altitude)');
    },
    duration: 8000
  },

  // CINEMATIC z boku (offset)
  cinematic_side: {
    setup() {
      setCameraMode(CameraMode.CINEMATIC);
      setCinematicOffset(0, 0.005);  // offset w prawo
      setCinematicTargetDistance(100);
      setCinematicHeightAbove(120);
      console.log('📹 Preset: Cinematic Side View (offset boczny)');
    },
    duration: 6000
  },

  // TOWER z przodu lotniska
  tower_runway: {
    setup() {
      setCameraMode(CameraMode.TOWER);
      setTowerOffset(500, 0);  // offset 500m z przodu
      setTowerHeight(400);
      setTowerLookPitch(-30);
      console.log('📹 Preset: Tower Runway (front view)');
    },
    duration: 7000
  },

  // FREE camera custom flight
  free_cinematic: {
    setup() {
      setCameraMode(CameraMode.FREE);
      freeCamera.pos.set(0, 80, -200);
      freeCamera.look.yaw = 0;
      freeCamera.look.pitch = 5;
      freeCamera.fov = 35;
      console.log('📹 Preset: Free Cinematic Custom');
    },
    duration: 0  // nie ma limitu czasu
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// DOKUMENTACJA NOWYCH FUNKCJI
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * CINEMATIC Camera - Sterowanie Pozycją i Zoomem:
 * 
 * setCinematicOffset(lat, lon)      - Offset pozycji kamery od samolotu (lat/lon)
 * setCinematicTargetDistance(dist)  - Idealna odległość dla autozooma
 * setCinematicHeightAbove(height)   - Wysokość kamery nad samolotem
 * setCinematicFOV(fov)              - Ustaw FOV (domyślnie 25°)
 * toggleCinematicAutoZoom()         - On/Off autozooma
 * toggleCinematicAutoFOV()          - On/Off automatycznego FOV (dostosowanie do zoomu)
 * 
 * Przykład: Cinematic z boku i bardzo bliskim zoomem
 * setCinematicOffset(0, 0.01);      // Daleko z boku
 * setCinematicTargetDistance(50);   // Bliski zoom
 * setCinematicHeightAbove(80);      // Niżej
 */

/**
 * FREE Camera - Ulepszone Sterowanie:
 * 
 * W grze:
 * - W/A/S/D      - Ruch do przodu/lewo/tył/prawo
 * - Q/E          - Ruch w dół/góra
 * - Mysz LPM     - Obrót kamery (yaw/pitch)
 * - Mysz PPM     - Przesunięcie boczne/pionowe
 * - Shift        - 2x szybciej
 * - Ctrl         - 0.5x wolniej
 * - Scroll       - Zmiana FOV
 * 
 * Z konsoli:
 * setFreeCameraSpeed(100)           - Zmiana prędkości (m/s)
 * setFreeCameraFOV(45)              - Zmiana FOV
 * setFreeCameraSpeedMultiplier(2)   - Mnożnik prędkości
 */

/**
 * TOWER Camera - Obserwacja z Wysokości:
 * 
 * setTowerHeight(meters)            - Wysokość kamery
 * setTowerOffset(lat, lon)          - Offset pozycji od spawnu/samolotu
 * setTowerLookDirection(heading)    - Kierunek, w którym patrzy (stopnie)
 * setTowerLookPitch(pitch)          - Kąt patrzenia w dół (-90 do 0)
 * toggleTowerTracking()             - Śledź samolot w poziomie (on/off)
 * 
 * Przykład: Wieża obserwacyjna z przodu lotniska
 * setTowerOffset(500, 0);           // 500m z przodu
 * setTowerHeight(300);              // 300m wysoko
 * setTowerLookPitch(-30);           // Patrz 30° w dół
 */

/**
 * Zmienne Globalne dla Sterowania w Konsoli:
 * 
 * freeCamera.speed = 50;            // Prędkość FREE camera
 * freeCamera.fov = 60;              // FOV FREE camera
 * cinematicCamera.fov = 25;         // FOV CINEMATIC camera
 * towerCamera.height = 500;         // Wysokość TOWER camera
 */


// Globalny scheduler dla sekwencji
let _sequenceRunning = false;
let _sequenceTimeout = null;

/**
 * Uruchom gotowy preset kamery
 * @param {string} presetName - nazwa presetu z CameraPresets
 */
function runCameraPreset(presetName) {
  if (!CameraPresets[presetName]) {
    console.error(`❌ Preset '${presetName}' nie istnieje!`);
    console.log('Dostępne presety:', Object.keys(CameraPresets));
    return;
  }

  const preset = CameraPresets[presetName];
  preset.setup();
  
  // Zaplanuj powrót do ORBIT po skończeniu
  if (_sequenceTimeout) clearTimeout(_sequenceTimeout);
  _sequenceTimeout = setTimeout(() => {
    console.log('✅ Koniec presetu, powrót do ORBIT');
    setCameraMode(CameraMode.ORBIT);
  }, preset.duration);
}

/**
 * Wyłącz obecny sekwencję
 */
function stopCameraPreset() {
  if (_sequenceTimeout) clearTimeout(_sequenceTimeout);
  console.log('⏹️  Zatrzymano sekwencję kamery');
}

/**
 * Sekwencja trailera — wszystkie presety po kolei
 */
function runFullTrailerSequence() {
  const presets = [
    'intro_flyby',
    'tower_overview',
    'cinematic_close',
    'action_flyby',
    'dolly_elegant',
    'cockpit_immersion'
  ];

  let index = 0;

  function playNext() {
    if (index >= presets.length) {
      console.log('🎬 Koniec sekwencji trailera!');
      setCameraMode(CameraMode.ORBIT);
      return;
    }

    const presetName = presets[index];
    console.log(`\n▶️  Scena ${index + 1}/${presets.length}: ${presetName}`);
    
    const preset = CameraPresets[presetName];
    preset.setup();

    // Zaplanuj następny preset
    _sequenceTimeout = setTimeout(() => {
      index++;
      playNext();
    }, preset.duration);
  }

  console.log('🎬 Uruchomiono pełną sekwencję trailera!');
  playNext();
}

/**
 * Szybka konfiguracja do nagrywania — wysokie FPS, bez UI
 */
function setupRecordingMode() {
  console.log('🎥 Włączony tryb nagrywania:');
  console.log('   - Przełącz kamerę wg. potrzeb');
  console.log('   - Użyj: runCameraPreset("nazwa")');
  console.log('   - Lub: runFullTrailerSequence()');
  console.log('   - Steruj grą przyciskami lotu');
  
  // Ukryj HUD (jeśli istnieje funkcja)
  if (window.toggleHUD) {
    toggleHUD();
    console.log('   - HUD ukryty');
  }

  document.body.classList.add('recording-mode');
}

/**
 * Resetuj nagrywanie
 */
function exitRecordingMode() {
  if (window.toggleHUD) toggleHUD();
  document.body.classList.remove('recording-mode');
  stopCameraPreset();
  setCameraMode(CameraMode.ORBIT);
  console.log('✅ Wyjście z trybu nagrywania');
}

// ═══════════════════════════════════════════════════════════════════════════════
// KONTROLKI KLAWISZÓW DO KAMER (opcjonalnie dodać do sim-controls.js)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Dodaj do obsługi keydown w sim-controls.js:
 * 
 * if (key === 'KeyC') cycleCameraMode();  // C = przełącz kamerę
 * if (key === 'Digit1') setCameraMode(CameraMode.ORBIT);
 * if (key === 'Digit2') setCameraMode(CameraMode.COCKPIT);
 * if (key === 'Digit3') setCameraMode(CameraMode.FREE);
 * if (key === 'Digit4') setCameraMode(CameraMode.CINEMATIC);
 * if (key === 'Digit5') setCameraMode(CameraMode.FLYBY);
 * if (key === 'Digit6') setCameraMode(CameraMode.DOLLY);
 * if (key === 'Digit7') setCameraMode(CameraMode.TOWER);
 * if (key === 'KeyR') setupRecordingMode();  // R = tryb nagrywania
 * 
 * // FREE camera keybinds
 * if (camMode === CameraMode.FREE) {
 *   if (key === 'KeyW') moveFreeCameraForward(dt);
 *   if (key === 'KeyS') moveFreeCameraBackward(dt);
 *   if (key === 'KeyA') moveFreeCameraLeft(dt);
 *   if (key === 'KeyD') moveFreeCameraRight(dt);
 *   if (key === 'KeyQ') moveFreeCameraDown(dt);
 *   if (key === 'KeyE') moveFreeCameraUp(dt);
 * }
 */

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNKCJE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Listuj wszystkie dostępne kamery
 */
function listCameras() {
  console.table(Object.values(CameraMode));
}

/**
 * Listuj wszystkie presety
 */
function listPresets() {
  Object.keys(CameraPresets).forEach(name => {
    const preset = CameraPresets[name];
    console.log(`▸ ${name} (${preset.duration}ms)`);
  });
}

/**
 * Informacja o obecnej kamerze
 */
function cameraInfo() {
  console.log(`Current Camera Mode: ${camMode}`);
  
  switch(camMode) {
    case CameraMode.FREE:
      console.log(`Position: (${freeCamera.pos.x.toFixed(1)}, ${freeCamera.pos.y.toFixed(1)}, ${freeCamera.pos.z.toFixed(1)})`);
      console.log(`Look: yaw=${freeCamera.look.yaw.toFixed(1)}°, pitch=${freeCamera.look.pitch.toFixed(1)}°`);
      console.log(`Speed: ${freeCamera.speed} m/s`);
      break;
    case CameraMode.CINEMATIC:
      console.log(`Target Distance: ${cinematicCamera.targetDistance}m`);
      console.log(`Height Above: ${cinematicCamera.heightAbove}m`);
      console.log(`Auto-Zoom: ${cinematicCamera.autoZoomEnabled}`);
      break;
    case CameraMode.FLYBY:
      console.log(`Orbit Speed: ${flybyCamera.orbitSpeed}°/s`);
      console.log(`Orbit Radius: ${flybyCamera.orbitRadius}m`);
      console.log(`Height Offset: ${flybyCamera.heightOffset}m`);
      break;
    case CameraMode.DOLLY:
      console.log(`Orbit Speed: ${dollyCamera.orbitSpeed}°/s`);
      console.log(`Orbit Radius: ${dollyCamera.orbitRadius}m`);
      console.log(`Auto-Zoom: ${dollyCamera.autoZoom}`);
      break;
    case CameraMode.TOWER:
      console.log(`Height: ${towerCamera.height}m`);
      console.log(`Tracking: ${towerCamera.trackPlane}`);
      break;
  }
}

// Eksport dla console
window.CameraPresets = CameraPresets;
window.runCameraPreset = runCameraPreset;
window.runFullTrailerSequence = runFullTrailerSequence;
window.setupRecordingMode = setupRecordingMode;
window.exitRecordingMode = exitRecordingMode;
window.listCameras = listCameras;
window.listPresets = listPresets;
window.cameraInfo = cameraInfo;
