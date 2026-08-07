'use strict';

// Section: CameraPresets.

const CameraPresets = {
  
  // Implementation note.
  intro_flyby: {
    setup() {
      setCameraMode(CameraMode.FLYBY);
      setFlybySpeed(30);  // Slow, dramatic movement.
      setFlybyRadius(250);  // Distant camera.
      flybyCamera.heightOffset = 60;  // wysoka perspektywa
      console.log('📹 Preset: Intro Flyby (30°/s, 250m)');
    },
    duration: 8000  // 8 seconds.
  },

  // Close cinematic view with automatic zoom.
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

  // Implementation note.
  action_flyby: {
    setup() {
      setCameraMode(CameraMode.FLYBY);
      setFlybySpeed(60);  // szybkie obroty
      setFlybyRadius(180);  // Configure flybyCamera.heightOffset.
      flybyCamera.heightOffset = 30;  // Low dramatic perspective.
      console.log('📹 Preset: Action Flyby (60°/s, 180m)');
    },
    duration: 5000
  },

  // Elegancki dolly zoom
  dolly_elegant: {
    setup() {
      setCameraMode(CameraMode.DOLLY);
      setDollySpeed(15);  // Slow and smooth.
      setDollyRadius(200);
      toggleDollyAutoZoom();
      console.log('📹 Preset: Dolly Elegant (15°/s, dolly zoom ON)');
    },
    duration: 10000
  },

  // Implementation note.
  tower_overview: {
    setup() {
      setCameraMode(CameraMode.TOWER);
      setTowerHeight(600);
      toggleTowerTracking();  // Implementation note.
      console.log('📹 Preset: Tower Overview (600m height, tracking ON)');
    },
    duration: 7000
  },

  // Custom slowmo flyby
  slowmo_flyby: {
    setup() {
      setCameraMode(CameraMode.FLYBY);
      setFlybySpeed(15);  // Very slow.
      setFlybyRadius(300);  // daleka perspektywa
      console.log('📹 Preset: Slowmo Flyby (15°/s, 300m) - idealna do slowmo');
    },
    duration: 15000
  },

  // Implementation note.
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
      setTowerHeight(1200);  // High tower view.
      toggleTowerTracking();
      console.log('📹 Preset: Eagle View (1200m altitude)');
    },
    duration: 8000
  },

  // Side cinematic view.
  cinematic_side: {
    setup() {
      setCameraMode(CameraMode.CINEMATIC);
      setCinematicOffset(0, 0.005);  // Shift right.
      setCinematicTargetDistance(100);
      setCinematicHeightAbove(120);
      console.log('📹 Preset: Cinematic Side View (offset boczny)');
    },
    duration: 6000
  },

  // Tower view from the airport front.
  tower_runway: {
    setup() {
      setCameraMode(CameraMode.TOWER);
      setTowerOffset(500, 0);  // Shift 500 m forward.
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
    duration: 0  // Implementation note.
  }
};

// // DOKUMENTACJA NOWYCH FUNKCJI //

/* Configure _sequenceRunning. */

/* Configure _sequenceRunning. */

/* Configure _sequenceRunning. */

/* Configure _sequenceRunning. */


// Configure _sequenceRunning.
let _sequenceRunning = false;
let _sequenceTimeout = null;

/* Run a camera preset. @param {string} presetName - preset name from CameraPresets. */
function runCameraPreset(presetName) {
  if (!CameraPresets[presetName]) {
    console.error(`❌ Preset '${presetName}' nie istnieje!`);
    console.log('Dostępne presety:', Object.keys(CameraPresets));
    return;
  }

  const preset = CameraPresets[presetName];
  preset.setup();
  
  // Configure if.
  if (_sequenceTimeout) clearTimeout(_sequenceTimeout);
  _sequenceTimeout = setTimeout(() => {
    console.log('✅ Koniec presetu, powrót do ORBIT');
    setCameraMode(CameraMode.ORBIT);
  }, preset.duration);
}

/* Handle function stopCameraPreset(). */
function stopCameraPreset() {
  if (_sequenceTimeout) clearTimeout(_sequenceTimeout);
  console.log('⏹️  Zatrzymano sekwencję kamery');
}

/* Play the trailer sequence through all presets. */
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

    // Configure _sequenceTimeout.
    _sequenceTimeout = setTimeout(() => {
      index++;
      playNext();
    }, preset.duration);
  }

  console.log('🎬 Uruchomiono pełną sekwencję trailera!');
  playNext();
}

/* Handle function setupRecordingMode(). */
function setupRecordingMode() {
  console.log('🎥 Włączony tryb nagrywania:');
  console.log('   - Przełącz kamerę wg. potrzeb');
  console.log('   - Użyj: runCameraPreset("nazwa")');
  console.log('   - Lub: runFullTrailerSequence()');
  console.log('   - Steruj grą przyciskami lotu');
  
  // Configure if.
  if (window.toggleHUD) {
    toggleHUD();
    console.log('   - HUD ukryty');
  }

  document.body.classList.add('recording-mode');
}

/* Layout note. */
function exitRecordingMode() {
  if (window.toggleHUD) toggleHUD();
  document.body.classList.remove('recording-mode');
  stopCameraPreset();
  setCameraMode(CameraMode.ORBIT);
  console.log('✅ Wyjście z trybu nagrywania');
}

// Section: function listCameras().

/* Handle function listCameras(). */

// // HELPER FUNKCJE //

/* Handle function listCameras(). */
function listCameras() {
  console.table(Object.values(CameraMode));
}

/* List all presets. */
function listPresets() {
  Object.keys(CameraPresets).forEach(name => {
    const preset = CameraPresets[name];
    console.log(`▸ ${name} (${preset.duration}ms)`);
  });
}

/* * * Informacja o obecnej kamerze */
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

// Configure window.CameraPresets.
window.CameraPresets = CameraPresets;
window.runCameraPreset = runCameraPreset;
window.runFullTrailerSequence = runFullTrailerSequence;
window.setupRecordingMode = setupRecordingMode;
window.exitRecordingMode = exitRecordingMode;
window.listCameras = listCameras;
window.listPresets = listPresets;
window.cameraInfo = cameraInfo;
