'use strict';

// Section: SimSound.

const SimSound = (() => {

  // Unit conversions, matching sim-hud.js.
  const MPS_KT  = 1.94384;
  const MPS_FPM = 196.85;
  const M_FT    = 3.28084;

  // Konfiguracja

  // Configure ALT_THRESHOLDS.
  const ALT_THRESHOLDS = [2500, 1000, 500, 400, 300, 200, 100, 50, 40, 30, 20, 10, 5];

  // Configure ALT_FILES.
  const ALT_FILES = {};
  ALT_THRESHOLDS.forEach(a => ALT_FILES[a] = `alt${a}`);

  // Section: VOICE_PRIORITY.
  const VOICE_PRIORITY = {
    pullUp:         1,
    stall:          2,
    sinkRatePullUp: 3,
    toLowTerrain:   4,
    sinkRate:       5,
    toLowGear:      6,
    toLowFlaps:     6,
    dontSink:       7,
    engineFailure:  8,
    // Implementation note.
    v1:             9,
    minimums:       9,
    alt100above:    9,
    alt20retard:    9,
  };
  ALT_THRESHOLDS.forEach(a => { VOICE_PRIORITY[ALT_FILES[a]] = 9; });

  // Configure VOICE_COOLDOWN.
  const VOICE_COOLDOWN = {
    pullUp:         2.0,
    stall:          2.0,
    sinkRatePullUp: 3.0,
    sinkRate:       3.0,
    toLowTerrain:   4.0,
    toLowFlaps:     4.0,
    toLowGear:      4.0,
    dontSink:       6.0,
    engineFailure: 99.0,  // One-shot callout.
  };

  // Section: LOOP_TONE_NAMES.
  const LOOP_TONE_NAMES = ['bankAngle', 'overspeed', 'cautionWarn'];

  // TONE group: repeated master warning with an intentional interval.
  const REPEAT_COOLDOWN = { masterWarn: 0.3 };

  // Configure SOUND_FILES.
  const SOUND_FILES = [
    'alt5','alt10','alt20','alt30','alt40','alt50','alt100',
    'alt200','alt300','alt400','alt500','alt1000','alt2500',
    'alt100above','alt20retard',
    'minimums','v1',
    'sinkRate','sinkRatePullUp','pullUp',
    'dontSink',
    'toLowTerrain','toLowFlaps','toLowGear',
    'stall','engineFailure',
    'masterWarn',
  ];

  // Section: sounds.

  const sounds = {};         // Name -> HTMLAudioElement (VOICE + REPEAT).
  let muted = false;
  let volume = 0.85;
  let contextUnlocked = false;

  // Callout altitude flags
  const altAnnounced = {};
  ALT_THRESHOLDS.forEach(a => altAnnounced[a] = false);
  let minimumsAnnounced = false;
  let hundredAboveAnnounced = false;
  let retardAnnounced = false;
  let dontSinkAnnounced = false;
  let engineFailAnnounced = false;
  let v1Announced = false;

  // Configure lastPlayTime.
  const lastPlayTime = {};  // Name -> timestamp in seconds.

  // Configure activeVoice.
  let activeVoice = null;
  let activeVoicePrio = 999;
  let activeCallout = null; // Configure prevAglFt.

  // Previous frame AGL for threshold crossing detection
  let prevAglFt = 0;
  let prevOnGround = true;

  // Configure justTookOff.
  let justTookOff = false;

  // Section: audioCtx.

  let audioCtx = null;
  const loopBuffers     = {}; // Name -> decoded AudioBuffer ready for playback.
  const loopSourceNodes = {}; // Configure loopGainNodes.
  const loopGainNodes   = {}; // Handle function ensureAudioCtx().

  function ensureAudioCtx() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioCtx;
  }

  function loadLoopBuffer(name) {
    const ctx = ensureAudioCtx();
    // Timeout - patrz analogiczna poprawka w sim-terrain.js/sim-physics.js/
    // sim-engine-sound.js. Bez tego, zawieszony fetch oznaczalby ze ten
    // dzwiek NIGDY sie nie zaladuje przez cala sesje, po cichu.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    fetch(`sounds/${name}.ogg`, { signal: controller.signal })
      .then(r => r.arrayBuffer())
      .then(data => ctx.decodeAudioData(data))
      .then(buf => { loopBuffers[name] = buf; })
      .catch(err => console.warn(`[Sound] Nie udało się zdekodować "${name}":`, err))
      .finally(() => clearTimeout(timeout));
  }

  function startLoop(name) {
    if (muted) return;
    const buf = loopBuffers[name];
    if (!buf) return; // Configure ctx.
    const ctx = ensureAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();

    if (!loopGainNodes[name]) {
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      loopGainNodes[name] = gain;
    }
    loopGainNodes[name].gain.value = volume;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true; // Implementation note.
    src.connect(loopGainNodes[name]);
    src.start(0);
    loopSourceNodes[name] = src;
  }

  function stopLoop(name) {
    const src = loopSourceNodes[name];
    if (src) {
      try { src.stop(); } catch (e) { /* Implementation note. */ }
      src.disconnect();
      loopSourceNodes[name] = null;
    }
  }

  // Handle function setLoopTone().
  function setLoopTone(name, active) {
    if (active && !loopSourceNodes[name]) {
      startLoop(name);
    } else if (!active && loopSourceNodes[name]) {
      stopLoop(name);
    }
  }

  // Preload

  function preload() {
    for (const name of SOUND_FILES) {
      const audio = new Audio(`sounds/${name}.ogg`);
      audio.preload = 'auto';
      audio.volume = volume;
      sounds[name] = audio;
    }
    // Implementation note.
    LOOP_TONE_NAMES.forEach(loadLoopBuffer);
  }

  // Section: function unlockAudio().

  function unlockAudio() {
    if (contextUnlocked) return;
    try {
      const ctx = ensureAudioCtx();
      if (ctx.state === 'suspended') ctx.resume();
      // Configure buf.
      const buf = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
      contextUnlocked = true;
    } catch (e) {
      // Configure contextUnlocked.
      contextUnlocked = true;
    }
  }

  // Pomocnicze

  function now() { return performance.now() / 1000; }

  function playSound(name) {
    if (muted || !sounds[name]) return;
    const s = sounds[name];
    s.volume = volume;
    // Configure s.currentTime.
    s.currentTime = 0;
    s.play().catch(() => {});  // autoplay policy
  }

  function stopSound(name) {
    if (!sounds[name]) return;
    const s = sounds[name];
    if (!s.paused) {
      s.pause();
      s.currentTime = 0;
    }
  }

  function isPlaying(name) {
    if (!sounds[name]) return false;
    return !sounds[name].paused && !sounds[name].ended;
  }

  // Section: function canPlayVoice().

  function canPlayVoice(name) {
    const cd = VOICE_COOLDOWN[name];
    if (!cd) return true; // Configure t.
    const t = now();
    if (lastPlayTime[name] && (t - lastPlayTime[name]) < cd) return false;
    return true;
  }

  function triggerVoice(name) {
    const prio = VOICE_PRIORITY[name] || 99;

    // Is the active callout still playing?
    if (activeVoice && isPlaying(activeVoice)) {
      // Configure if.
      if (prio < activeVoicePrio) {
        stopSound(activeVoice);
      } else {
        return; // Implementation note.
      }
    }

    if (!canPlayVoice(name)) return;

    playSound(name);
    lastPlayTime[name] = now();
    activeVoice = name;
    activeVoicePrio = prio;
  }

  function clearVoice(name) {
    if (activeVoice === name) {
      stopSound(name);
      activeVoice = null;
      activeVoicePrio = 999;
      if (activeCallout === name) activeCallout = null;
    }
  }

  // Section: function triggerRepeatTone().

  function triggerRepeatTone(name) {
    if (muted || !sounds[name]) return;
    const t = now();
    const cd = REPEAT_COOLDOWN[name] || 3;
    if (lastPlayTime[name] && (t - lastPlayTime[name]) < cd) return;
    playSound(name);
    lastPlayTime[name] = t;
  }

  // Section: function queueCallout().

  function queueCallout(name) {
    // Configure if.
    if (activeVoice && isPlaying(activeVoice)) return;

    // Configure if.
    if (activeCallout && isPlaying(activeCallout)) return;

    playSound(name);
    activeVoice = name;
    activeVoicePrio = VOICE_PRIORITY[name] || 9;
    activeCallout = name;
  }

  // Reset all flags after aircraft reset or climbing above 3000 ft.

  function resetCallouts() {
    ALT_THRESHOLDS.forEach(a => altAnnounced[a] = false);
    minimumsAnnounced = false;
    hundredAboveAnnounced = false;
    retardAnnounced = false;
    dontSinkAnnounced = false;
    engineFailAnnounced = false;
    v1Announced = false;
    justTookOff = false;

    // Configure if.
    if (activeVoice) { stopSound(activeVoice); activeVoice = null; activeVoicePrio = 999; }
    activeCallout = null;
    LOOP_TONE_NAMES.forEach(stopLoop);

    prevAglFt = 0;
    prevOnGround = true;
  }

  // Section: function update().

  function update(dt) {
    if (!activeEntity) return;
    const plane = activeEntity;

    // Read aircraft state.
    const aglFt   = plane.agl * M_FT;
    const iasMps  = plane.airspeed;
    const iasKt   = iasMps * MPS_KT;
    const vsFpm   = plane.vs * MPS_FPM;
    const bankDeg = Math.abs(plane.roll);   // Configure flaps.
    const flaps   = plane.flaps;
    const gearDn  = plane.gearDown;
    const onGnd   = plane.onGround;
    const stalling = plane._isStalling;
    // Configure overspeeding.
    const overspeeding = plane._isOverspeed;
    const throttle = plane.throttle;

    // Configure cautionActive.
    let cautionActive = false;

    // Detekcja liftoff / touchdown
    if (prevOnGround && !onGnd) {
      // Configure justTookOff.
      justTookOff = true;
      // Implementation note.
      ALT_THRESHOLDS.forEach(a => altAnnounced[a] = false);
      minimumsAnnounced = false;
      hundredAboveAnnounced = false;
      retardAnnounced = false;
      dontSinkAnnounced = false;
      engineFailAnnounced = false;
    }
    if (!prevOnGround && onGnd) {
      // Configure justTookOff.
      justTookOff = false;
      v1Announced = false; // Configure if.
      if (activeVoice) { stopSound(activeVoice); activeVoice = null; activeVoicePrio = 999; activeCallout = null; }
    }

    // Configure if.
    if (aglFt > 3000 && !onGnd) {
      ALT_THRESHOLDS.forEach(a => altAnnounced[a] = false);
      minimumsAnnounced = false;
      hundredAboveAnnounced = false;
      retardAnnounced = false;
      justTookOff = false;
    }

    if (!onGnd) {

      // Section: if.

      // STALL
      if (stalling) {
        triggerVoice('stall');
      } else {
        clearVoice('stall');
      }

      // PULL UP (MODE 1 krytyczny sink rate)
      if (vsFpm < -4000 && aglFt < 500) {
        triggerVoice('pullUp');
        triggerRepeatTone('masterWarn');
      } else {
        clearVoice('pullUp');
      }

      // Section: if.
      if (vsFpm < -3000 && aglFt < 1000 && !(vsFpm < -4000 && aglFt < 500)) {
        triggerVoice('sinkRatePullUp');
        cautionActive = true;
      } else {
        clearVoice('sinkRatePullUp');
      }

      // SINK RATE (mode 1: excessive descent rate).
      if (vsFpm < -1500 && aglFt < 2500 && !(vsFpm < -3000 && aglFt < 1000)) {
        triggerVoice('sinkRate');
        cautionActive = true;
      } else {
        clearVoice('sinkRate');
      }

      // TOO LOW TERRAIN (MODE 2)
      if (aglFt < 500 && !gearDn && vsFpm < -300) {
        triggerVoice('toLowTerrain');
        cautionActive = true;
      } else {
        clearVoice('toLowTerrain');
      }

      // TOO LOW GEAR (MODE 4)
      if (aglFt < 800 && vsFpm < -200 && !gearDn) {
        triggerVoice('toLowGear');
        cautionActive = true;
      } else {
        clearVoice('toLowGear');
      }

      // TOO LOW FLAPS (MODE 4)
      if (aglFt < 800 && vsFpm < -200 && gearDn && flaps < 3) {
        triggerVoice('toLowFlaps');
        cautionActive = true;
      } else {
        clearVoice('toLowFlaps');
      }

      // DON'T SINK (mode 3 after takeoff).
      if (justTookOff && vsFpm < -500 && aglFt < 1000 && !dontSinkAnnounced) {
        triggerVoice('dontSink');
        dontSinkAnnounced = true;
      }
      if (aglFt > 1500) justTookOff = false; // End takeoff mode above 1500 ft.

      // ENGINE FAILURE
      if (throttle < 0.01 && iasKt > 80 && aglFt > 100) {
        cautionActive = true;
        if (!engineFailAnnounced) {
          triggerVoice('engineFailure');
          engineFailAnnounced = true;
        }
      }
      // Reset engine-failure flag when the pilot adds thrust.
      if (throttle > 0.05) engineFailAnnounced = false;

      // Section: if.

      if (plane.vs < 0) { // Descending.
        for (const alt of ALT_THRESHOLDS) {
          if (aglFt < alt && prevAglFt >= alt && !altAnnounced[alt]) {
            queueCallout(ALT_FILES[alt]);
            altAnnounced[alt] = true;
            break; // Implementation note.
          }
        }

        // MINIMUMS (200 ft)
        if (aglFt < 200 && prevAglFt >= 200 && !minimumsAnnounced) {
          queueCallout('minimums');
          minimumsAnnounced = true;
        }

        // Section: if.
        if (aglFt < 300 && prevAglFt >= 300 && !hundredAboveAnnounced) {
          queueCallout('alt100above');
          hundredAboveAnnounced = true;
        }

        // Section: if.
        if (aglFt < 20 && throttle > 0.05 && !retardAnnounced) {
          queueCallout('alt20retard');
          retardAnnounced = true;
        }
      }

    } else {
      // On-ground V1 callout during the takeoff roll.
      if (iasMps >= A321_PARAMS.V1 && !v1Announced) {
        triggerVoice('v1');
        v1Announced = true;
      }
      // Configure if.
      if (iasMps < A321_PARAMS.V1 * 0.5) v1Announced = false;
    }

    // Implementation note.

    // Implementation note.
    setLoopTone('bankAngle', !onGnd && bankDeg > 33);

    // Implementation note.
    setLoopTone('overspeed', overspeeding);

    // Implementation note.
    setLoopTone('cautionWarn', cautionActive);

    // Configure if.
    if (activeVoice && !isPlaying(activeVoice)) {
      activeVoice = null;
      activeVoicePrio = 999;
      activeCallout = null;
    }

    // Configure prevAglFt.
    prevAglFt = aglFt;
    prevOnGround = onGnd;
  }

  // Toggle mute

  function toggleMute() {
    muted = !muted;
    if (muted) {
      // Zatrzymaj wszystko
      for (const name in sounds) {
        if (!sounds[name].paused) {
          sounds[name].pause();
          sounds[name].currentTime = 0;
        }
      }
      activeVoice = null;
      activeVoicePrio = 999;
      activeCallout = null;
      LOOP_TONE_NAMES.forEach(stopLoop);
    }
    // Configure btn.
    const btn = document.getElementById('btn-mute');
    if (btn) btn.textContent = muted ? '🔇 Mute' : '🔊 Mute';
    const mbtn = document.getElementById('mb-mute-lbl');
    if (mbtn) mbtn.textContent = muted ? 'MUTE' : 'SND';
    const mbtnI = document.getElementById('mb-mute-icon');
    if (mbtnI) mbtnI.textContent = muted ? '🔇' : '🔊';
    console.log(`[Sound] ${muted ? 'MUTED' : 'UNMUTED'}`);
  }

  // Publiczny API

  return {
    preload,
    unlockAudio,
    update,
    resetCallouts,
    toggleMute,
    get muted() { return muted; },
  };

})();

// Handle loading and error cases.
SimSound.preload();

// Implementation note.
['click', 'touchstart', 'keydown'].forEach(ev => {
  document.addEventListener(ev, function _unlock() {
    SimSound.unlockAudio();
    document.removeEventListener(ev, _unlock);
  }, { once: true });
});
