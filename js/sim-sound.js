'use strict';

// ══════════════════════════════════════════════════════════════════════════════
//  sim-sound.js — System dźwięków kokpitowych (GPWS / Warnings / Callouts)
//
//  Dźwięki ładowane z folderu sounds/ (pliki .ogg). Cała logika opiera się na
//  odczycie stanu z globalnego `activeEntity` (A321Entity) w każdej klatce.
//
//  Dwa NIEZALEŻNE kanały:
//    • VOICE  — komunikaty słowne GPWS (PULL UP, STALL, SINK RATE, TOO LOW...,
//               DON'T SINK, ENGINE FAILURE), callout V1 na rozbiegu oraz
//               callouty wysokości/minimums/retard. Tylko JEDEN głos na raz —
//               dwa nakładające się słowa brzmiałyby jak bełkot —
//               priorytetyzowany, wyższy priorytet przerywa niższy.
//    • TONE   — dzwonki/tony:
//               - LOOP (bankAngle, overspeed, cautionWarn): odtwarzane przez
//                 Web Audio API jako zdekodowany bufor PCM w
//                 AudioBufferSourceNode z loop=true — PRAWDZIWIE bezszwowa
//                 pętla, bez żadnej przerwy ani trzasku między powtórzeniami
//                 (zwykły <audio loop> tego nie gwarantuje — OGG Vorbis ma
//                 zazwyczaj mały padding na początku/końcu próbki, co dawało
//                 słyszalną mikroprzerwę).
//               - REPEAT (masterWarn): krótki "ding" powtarzany co kilka
//                 sekund (odstęp > długość pliku) — tu przerwa MA być, to
//                 zamierzony rytm dzwonka master warning.
//               Każdy TONE gra na WŁASNYM, niezależnym kanale — mogą brzmieć
//               razem ze sobą I razem z aktywnym komunikatem VOICE (dokładnie
//               jak w prawdziwym kokpicie: dzwonek master caution nakłada
//               się na głos GPWS, a bank angle może brzmieć równocześnie z
//               SINK RATE).
//
//  Priorytet w kanale VOICE (od najwyższego):
//    PULL UP > STALL > SINK RATE PULL UP > TOO LOW TERRAIN > SINK RATE >
//    TOO LOW GEAR/FLAPS > DON'T SINK > ENGINE FAILURE > V1 / ALTITUDE CALLOUTS
//
//  Klawisz M — toggle mute.
// ══════════════════════════════════════════════════════════════════════════════

const SimSound = (() => {

  // ── Konwersje (identyczne jak w sim-hud.js) ────────────────────────────────
  const MPS_KT  = 1.94384;
  const MPS_FPM = 196.85;
  const M_FT    = 3.28084;

  // ── Konfiguracja ───────────────────────────────────────────────────────────

  // Progi calloutów wysokości (AGL w ft) — odtwarzane przy opadaniu
  const ALT_THRESHOLDS = [2500, 1000, 500, 400, 300, 200, 100, 50, 40, 30, 20, 10, 5];

  // Mapowanie progów na nazwy plików
  const ALT_FILES = {};
  ALT_THRESHOLDS.forEach(a => ALT_FILES[a] = `alt${a}`);

  // ── Grupa VOICE — komunikaty słowne, jeden na raz, priorytetyzowane ────────
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
    // V1 i callouty wysokości/minimums/retard — najniższy priorytet w kanale
    // VOICE, nie przerywają żadnego "prawdziwego" ostrzeżenia GPWS
    v1:             9,
    minimums:       9,
    alt100above:    9,
    alt20retard:    9,
  };
  ALT_THRESHOLDS.forEach(a => { VOICE_PRIORITY[ALT_FILES[a]] = 9; });

  // Cooldowny w kanale VOICE (sekundy) — tylko dla realnych ostrzeżeń GPWS;
  // callouty pilnowane są osobno przez flagi *Announced (patrz niżej), więc
  // nie potrzebują cooldownu.
  const VOICE_COOLDOWN = {
    pullUp:         2.0,
    stall:          2.0,
    sinkRatePullUp: 3.0,
    sinkRate:       3.0,
    toLowTerrain:   4.0,
    toLowFlaps:     4.0,
    toLowGear:      4.0,
    dontSink:       6.0,
    engineFailure: 99.0,  // jednorazowe
  };

  // ── Grupa TONE (LOOP) — bezszwowa pętla Web Audio, bez przerwy ─────────────
  const LOOP_TONE_NAMES = ['bankAngle', 'overspeed', 'cautionWarn'];

  // ── Grupa TONE (REPEAT) — master warning, "ding" co X sekund (celowa przerwa)
  const REPEAT_COOLDOWN = { masterWarn: 0.3 };

  // Zwykłe pliki dźwiękowe (HTMLAudioElement) — VOICE + REPEAT tone.
  // UWAGA: bankAngle/overspeed/cautionWarn NIE są tu — odtwarzane osobno
  // przez Web Audio API (patrz niżej), żeby pętla była naprawdę bezszwowa.
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

  // ── Stan wewnętrzny ────────────────────────────────────────────────────────

  const sounds = {};         // nazwa -> HTMLAudioElement (VOICE + REPEAT)
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

  // Cooldown tracking — wspólne dla VOICE (one-shot) i REPEAT tone
  const lastPlayTime = {};  // nazwa -> timestamp (s)

  // Aktualnie grający dźwięk w kanale VOICE (jeden na raz)
  let activeVoice = null;
  let activeVoicePrio = 999;
  let activeCallout = null; // ostatnio zakolejkowany callout (podzbiór activeVoice)

  // Previous frame AGL for threshold crossing detection
  let prevAglFt = 0;
  let prevOnGround = true;

  // Flaga: samolot dopiero wystartował (śledzenie dla DON'T SINK)
  let justTookOff = false;

  // ── Web Audio API — bezszwowe pętle (bankAngle, overspeed, cautionWarn) ────

  let audioCtx = null;
  const loopBuffers     = {}; // nazwa -> zdekodowany AudioBuffer (gotowy do gry)
  const loopSourceNodes = {}; // nazwa -> aktualnie grający AudioBufferSourceNode | null
  const loopGainNodes   = {}; // nazwa -> trwały GainNode (kontrola głośności)

  function ensureAudioCtx() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioCtx;
  }

  function loadLoopBuffer(name) {
    const ctx = ensureAudioCtx();
    fetch(`sounds/${name}.ogg`)
      .then(r => r.arrayBuffer())
      .then(data => ctx.decodeAudioData(data))
      .then(buf => { loopBuffers[name] = buf; })
      .catch(err => console.warn(`[Sound] Nie udało się zdekodować "${name}":`, err));
  }

  function startLoop(name) {
    if (muted) return;
    const buf = loopBuffers[name];
    if (!buf) return; // jeszcze nie zdekodowany — setLoopTone spróbuje ponownie w kolejnej klatce
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
    src.loop = true; // bezszwowa pętla na poziomie próbek — bez przerwy
    src.connect(loopGainNodes[name]);
    src.start(0);
    loopSourceNodes[name] = src;
  }

  function stopLoop(name) {
    const src = loopSourceNodes[name];
    if (src) {
      try { src.stop(); } catch (e) { /* już zatrzymany */ }
      src.disconnect();
      loopSourceNodes[name] = null;
    }
  }

  // Włącz raz na zboczu narastającym, wyłącz raz na opadającym. Jeśli bufor
  // nie był jeszcze gotowy (albo kontekst był zawieszony) przy pierwszej
  // próbie, kolejne wywołanie z active=true (następna klatka) spróbuje
  // ponownie — bo loopSourceNodes[name] wciąż jest null.
  function setLoopTone(name, active) {
    if (active && !loopSourceNodes[name]) {
      startLoop(name);
    } else if (!active && loopSourceNodes[name]) {
      stopLoop(name);
    }
  }

  // ── Preload ────────────────────────────────────────────────────────────────

  function preload() {
    for (const name of SOUND_FILES) {
      const audio = new Audio(`sounds/${name}.ogg`);
      audio.preload = 'auto';
      audio.volume = volume;
      sounds[name] = audio;
    }
    // Bufory do bezszwowej pętli (Web Audio) — dekodowane równolegle w tle
    LOOP_TONE_NAMES.forEach(loadLoopBuffer);
  }

  // ── AudioContext unlock (wymagany przez przeglądarki) ──────────────────────

  function unlockAudio() {
    if (contextUnlocked) return;
    try {
      const ctx = ensureAudioCtx();
      if (ctx.state === 'suspended') ctx.resume();
      // Odtwórz cichy bufor żeby odblokować
      const buf = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
      contextUnlocked = true;
    } catch (e) {
      // Fallback — nie wszystkie przeglądarki wymagają tego
      contextUnlocked = true;
    }
  }

  // ── Pomocnicze ─────────────────────────────────────────────────────────────

  function now() { return performance.now() / 1000; }

  function playSound(name) {
    if (muted || !sounds[name]) return;
    const s = sounds[name];
    s.volume = volume;
    // Jeśli dźwięk jeszcze gra, zresetuj go
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

  // ── Kanał VOICE — jeden komunikat słowny na raz, priorytetyzowany ──────────

  function canPlayVoice(name) {
    const cd = VOICE_COOLDOWN[name];
    if (!cd) return true; // callouty — brak cooldownu, pilnują ich flagi *Announced
    const t = now();
    if (lastPlayTime[name] && (t - lastPlayTime[name]) < cd) return false;
    return true;
  }

  function triggerVoice(name) {
    const prio = VOICE_PRIORITY[name] || 99;

    // Czy aktywny komunikat nadal gra?
    if (activeVoice && isPlaying(activeVoice)) {
      // Nowy komunikat ma wyższy priorytet (niższa liczba)?
      if (prio < activeVoicePrio) {
        stopSound(activeVoice);
      } else {
        return; // aktywny komunikat ma wyższy/równy priorytet — nie przerywaj
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

  // ── Kanał TONE (REPEAT) — master warning, "ding" co X sekund ───────────────
  // Całkowicie niezależny od VOICE i od LOOP tone — może brzmieć jednocześnie
  // z nimi (tak jak w realu master warning chime nakłada się na głos GPWS).

  function triggerRepeatTone(name) {
    if (muted || !sounds[name]) return;
    const t = now();
    const cd = REPEAT_COOLDOWN[name] || 3;
    if (lastPlayTime[name] && (t - lastPlayTime[name]) < cd) return;
    playSound(name);
    lastPlayTime[name] = t;
  }

  // ── Callout system — kolejkowanie calloutów wysokości (kanał VOICE) ────────

  function queueCallout(name) {
    // Nie przerywaj aktywnego komunikatu VOICE calloutem — callouty mają
    // najniższy priorytet w tym kanale.
    if (activeVoice && isPlaying(activeVoice)) return;

    // Jeśli inny callout właśnie gra, poczekaj (unika nakładania się cyfr)
    if (activeCallout && isPlaying(activeCallout)) return;

    playSound(name);
    activeVoice = name;
    activeVoicePrio = VOICE_PRIORITY[name] || 9;
    activeCallout = name;
  }

  // ── Resetuj wszystkie flagi (po reset samolotu lub wznoszeniu > 3000ft) ───

  function resetCallouts() {
    ALT_THRESHOLDS.forEach(a => altAnnounced[a] = false);
    minimumsAnnounced = false;
    hundredAboveAnnounced = false;
    retardAnnounced = false;
    dontSinkAnnounced = false;
    engineFailAnnounced = false;
    v1Announced = false;
    justTookOff = false;

    // Zatrzymaj wszystkie aktywne kanały
    if (activeVoice) { stopSound(activeVoice); activeVoice = null; activeVoicePrio = 999; }
    activeCallout = null;
    LOOP_TONE_NAMES.forEach(stopLoop);

    prevAglFt = 0;
    prevOnGround = true;
  }

  // ── Główna logika aktualizacji (wywoływana co klatkę) ──────────────────────

  function update(dt) {
    if (!activeEntity) return;
    const plane = activeEntity;

    // ── Odczyt stanu samolotu ────────────────────────────────────────────────
    const aglFt   = plane.agl * M_FT;
    const iasMps  = plane.airspeed;
    const iasKt   = iasMps * MPS_KT;
    const vsFpm   = plane.vs * MPS_FPM;
    const bankDeg = Math.abs(plane.roll);   // plane.roll jest w stopniach
    const flaps   = plane.flaps;
    const gearDn  = plane.gearDown;
    const onGnd   = plane.onGround;
    const stalling = plane._isStalling;
    // Overspeed liczony w sim-physics.js z histerezą (plane._isOverspeed) —
    // surowe porównanie iasKt > vmoKt migotałoby klatka po klatce na granicy
    // odcięcia, bo prędkość jest tam twardo przycinana do VMO. Ta sama flaga
    // steruje też wskaźnikiem w HUD (sim-hud.js), więc dźwięk i UI są zawsze
    // zsynchronizowane.
    const overspeeding = plane._isOverspeed;
    const throttle = plane.throttle;

    // Czy w tej klatce powinien grać (bezszwowy loop) caution warning —
    // zbierane z kilku niezależnych warunków GPWS poniżej.
    let cautionActive = false;

    // ── Detekcja liftoff / touchdown ────────────────────────────────────────
    if (prevOnGround && !onGnd) {
      // Właśnie wystartował
      justTookOff = true;
      // Reset calloutów przy liftoff (na nowe podejście)
      ALT_THRESHOLDS.forEach(a => altAnnounced[a] = false);
      minimumsAnnounced = false;
      hundredAboveAnnounced = false;
      retardAnnounced = false;
      dontSinkAnnounced = false;
      engineFailAnnounced = false;
    }
    if (!prevOnGround && onGnd) {
      // Właśnie wylądował
      justTookOff = false;
      v1Announced = false; // gotowe na kolejny start
      // Zatrzymaj ostrzeżenia głosowe po lądowaniu
      if (activeVoice) { stopSound(activeVoice); activeVoice = null; activeVoicePrio = 999; activeCallout = null; }
    }

    // Reset calloutów gdy wzniesie się powyżej 3000 ft AGL
    if (aglFt > 3000 && !onGnd) {
      ALT_THRESHOLDS.forEach(a => altAnnounced[a] = false);
      minimumsAnnounced = false;
      hundredAboveAnnounced = false;
      retardAnnounced = false;
      justTookOff = false;
    }

    if (!onGnd) {

      // ════════════════════════════════════════════════════════════════════════
      //  OSTRZEŻENIA GŁOSOWE (kanał VOICE — jeden na raz, priorytetyzowane)
      // ════════════════════════════════════════════════════════════════════════

      // ── STALL ─────────────────────────────────────────────────────────────
      if (stalling) {
        triggerVoice('stall');
      } else {
        clearVoice('stall');
      }

      // ── PULL UP (MODE 1 — krytyczny sink rate) ────────────────────────────
      if (vsFpm < -4000 && aglFt < 500) {
        triggerVoice('pullUp');
        triggerRepeatTone('masterWarn');
      } else {
        clearVoice('pullUp');
      }

      // ── SINK RATE PULL UP (MODE 1 — ciężki sink rate) ─────────────────────
      if (vsFpm < -3000 && aglFt < 1000 && !(vsFpm < -4000 && aglFt < 500)) {
        triggerVoice('sinkRatePullUp');
        cautionActive = true;
      } else {
        clearVoice('sinkRatePullUp');
      }

      // ── SINK RATE (MODE 1 — nadmierny sink rate) ──────────────────────────
      if (vsFpm < -1500 && aglFt < 2500 && !(vsFpm < -3000 && aglFt < 1000)) {
        triggerVoice('sinkRate');
        cautionActive = true;
      } else {
        clearVoice('sinkRate');
      }

      // ── TOO LOW TERRAIN (MODE 2) ──────────────────────────────────────────
      if (aglFt < 500 && !gearDn && vsFpm < -300) {
        triggerVoice('toLowTerrain');
        cautionActive = true;
      } else {
        clearVoice('toLowTerrain');
      }

      // ── TOO LOW GEAR (MODE 4) ─────────────────────────────────────────────
      if (aglFt < 800 && vsFpm < -200 && !gearDn) {
        triggerVoice('toLowGear');
        cautionActive = true;
      } else {
        clearVoice('toLowGear');
      }

      // ── TOO LOW FLAPS (MODE 4) ────────────────────────────────────────────
      if (aglFt < 800 && vsFpm < -200 && gearDn && flaps < 3) {
        triggerVoice('toLowFlaps');
        cautionActive = true;
      } else {
        clearVoice('toLowFlaps');
      }

      // ── DON'T SINK (MODE 3 — po starcie) ─────────────────────────────────
      if (justTookOff && vsFpm < -500 && aglFt < 1000 && !dontSinkAnnounced) {
        triggerVoice('dontSink');
        dontSinkAnnounced = true;
      }
      if (aglFt > 1500) justTookOff = false; // wzniesienie ponad 1500 ft → koniec trybu "po starcie"

      // ── ENGINE FAILURE ────────────────────────────────────────────────────
      if (throttle < 0.01 && iasKt > 80 && aglFt > 100) {
        cautionActive = true;
        if (!engineFailAnnounced) {
          triggerVoice('engineFailure');
          engineFailAnnounced = true;
        }
      }
      // Reset flagi engine failure gdy pilot doda gaz
      if (throttle > 0.05) engineFailAnnounced = false;

      // ════════════════════════════════════════════════════════════════════════
      //  CALLOUTS WYSOKOŚCI (kanał VOICE, najniższy priorytet)
      // ════════════════════════════════════════════════════════════════════════

      if (plane.vs < 0) { // opadanie
        for (const alt of ALT_THRESHOLDS) {
          if (aglFt < alt && prevAglFt >= alt && !altAnnounced[alt]) {
            queueCallout(ALT_FILES[alt]);
            altAnnounced[alt] = true;
            break; // jeden callout na klatkę
          }
        }

        // ── MINIMUMS (200 ft) ─────────────────────────────────────────────
        if (aglFt < 200 && prevAglFt >= 200 && !minimumsAnnounced) {
          queueCallout('minimums');
          minimumsAnnounced = true;
        }

        // ── HUNDRED ABOVE (300 ft = 100 ft nad domyślnymi minimami 200 ft) ─
        if (aglFt < 300 && prevAglFt >= 300 && !hundredAboveAnnounced) {
          queueCallout('alt100above');
          hundredAboveAnnounced = true;
        }

        // ── RETARD (20 ft, throttle nie na idle) ──────────────────────────
        if (aglFt < 20 && throttle > 0.05 && !retardAnnounced) {
          queueCallout('alt20retard');
          retardAnnounced = true;
        }
      }

    } else {
      // ════════════════════════════════════════════════════════════════════════
      //  NA ZIEMI — callout V1 podczas rozbiegu startowego
      // ════════════════════════════════════════════════════════════════════════
      if (iasMps >= A321_PARAMS.V1 && !v1Announced) {
        triggerVoice('v1');
        v1Announced = true;
      }
      // Wyraźne zwolnienie na ziemi (np. przerwany start) resetuje flagę,
      // żeby V1 mogło zabrzmieć ponownie przy kolejnym podejściu do startu
      if (iasMps < A321_PARAMS.V1 * 0.5) v1Announced = false;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  TONY (kanał TONE — niezależne kanały, mogą grać razem ze sobą i z VOICE)
    // ════════════════════════════════════════════════════════════════════════

    // ── BANK ANGLE (tylko w powietrzu, jak w oryginale) — bezszwowa pętla ─────
    setLoopTone('bankAngle', !onGnd && bankDeg > 33);

    // ── OVERSPEED (ta sama flaga co HUD — zawsze spójne) — bezszwowa pętla ───
    setLoopTone('overspeed', overspeeding);

    // ── CAUTION WARN — bezszwowa pętla, dopóki trwa którykolwiek z warunków ──
    setLoopTone('cautionWarn', cautionActive);

    // Czyść aktywny komunikat VOICE jeśli dźwięk skończył się grać
    if (activeVoice && !isPlaying(activeVoice)) {
      activeVoice = null;
      activeVoicePrio = 999;
      activeCallout = null;
    }

    // Zapamiętaj stan dla porównania w następnej klatce
    prevAglFt = aglFt;
    prevOnGround = onGnd;
  }

  // ── Toggle mute ────────────────────────────────────────────────────────────

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
    // Aktualizuj ikonkę mute w HUD
    const btn = document.getElementById('btn-mute');
    if (btn) btn.textContent = muted ? '🔇 Mute' : '🔊 Mute';
    const mbtn = document.getElementById('mb-mute-lbl');
    if (mbtn) mbtn.textContent = muted ? 'MUTE' : 'SND';
    const mbtnI = document.getElementById('mb-mute-icon');
    if (mbtnI) mbtnI.textContent = muted ? '🔇' : '🔊';
    console.log(`[Sound] ${muted ? 'MUTED' : 'UNMUTED'}`);
  }

  // ── Publiczny API ──────────────────────────────────────────────────────────

  return {
    preload,
    unlockAudio,
    update,
    resetCallouts,
    toggleMute,
    get muted() { return muted; },
  };

})();

// ── Pre-load dźwięków od razu po załadowaniu skryptu ─────────────────────────
SimSound.preload();

// ── AudioContext unlock przy pierwszej interakcji użytkownika ─────────────────
['click', 'touchstart', 'keydown'].forEach(ev => {
  document.addEventListener(ev, function _unlock() {
    SimSound.unlockAudio();
    document.removeEventListener(ev, _unlock);
  }, { once: true });
});
