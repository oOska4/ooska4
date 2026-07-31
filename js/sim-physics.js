'use strict';

// Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬ ÄąÂadowanie modelu A321 z a321.obj + a321.mtl Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬
// (a321.mtl wskazuje tekstury w folderze objwmtl/ Ă˘â‚¬â€ť Äąâ€şcieÄąÄ˝ki wzglĂ„â„˘dne, nie
// trzeba ich tu powtarzaĂ„â€ˇ; wystarczy wczytaĂ„â€ˇ .mtl, a potem .obj z tymi materiaÄąâ€šami)

const A321_OBJ_URL = './a321.obj';
const A321_MTL_URL = './a321.mtl';

// JeÄąâ€şli po wczytaniu samolot bĂ„â„˘dzie odwrÄ‚Ĺ‚cony nosem w zÄąâ€šĂ„â€¦ stronĂ„â„˘ albo ÄąĹźle przechylony,
// zmieÄąâ€ž tĂ„â„˘ wartoÄąâ€şĂ„â€ˇ (np. Math.PI/2, -Math.PI/2, Math.PI) aÄąÄ˝ dziÄ‚Ĺ‚b wskaÄąÄ˝e w +Z w lokalnym ukÄąâ€šadzie.
const A321_MODEL_ROT_Y = Math.PI / 2;
// JeÄąâ€şli samolot bĂ„â„˘dzie zbyt duÄąÄ˝y/maÄąâ€šy wzglĂ„â„˘dem terenu, zmieÄąâ€ž skalĂ„â„˘ (np. 0.01 jeÄąâ€şli model jest w cm).
const A321_MODEL_SCALE = 0.25;
// JeÄąâ€şli samolot bĂ„â„˘dzie przesuniĂ„â„˘ty w gÄ‚Ĺ‚rĂ„â„˘/dÄ‚Ĺ‚Äąâ€š wzglĂ„â„˘dem terenu, zmieÄąâ€ž przesuniĂ„â„˘cie (np. 0.01 jeÄąâ€şli model jest w cm).
const A321_MODEL_TRANSLATE_Y = -4.5;

// Obiekty w a321.obj o nazwie zaczynajĂ„â€¦cej siĂ„â„˘ od tego prefiksu (gears_back_tires,
// gears_covers, gears_front_tire, gears_holder_*) trafiajĂ„â€¦ do wspÄ‚Ĺ‚lnej grupy
// "gearGroup", tak jak wczeÄąâ€şniej, gdy kaÄąÄ˝dy z nich byÄąâ€š osobnym plikiem .obj Ă˘â‚¬â€ť
// dziĂ„â„˘ki temu chowanie/pokazywanie podwozia (updateGearVisibility) dziaÄąâ€ša bez zmian.
const A321_GEAR_PREFIX = 'gears_';

function _explainModelLoadError(url, err) {
  if (location.protocol === 'file:') {
    console.error(`[A321] Nie moÄąÄ˝na wczytaĂ„â€ˇ "${url}" z pliku lokalnego. Uruchom stronĂ„â„˘ przez lokalny serwer HTTP, np. python -m http.server 8000.`);
  }
  const cause = err && err.message ? err.message : err;
  return new Error(`[A321] BÄąâ€šĂ„â€¦d Äąâ€šadowania ${url}: ${cause}`);
}

async function loadA321Model() {
  // 1) Wczytaj definicje materiaÄąâ€šÄ‚Ĺ‚w z .mtl (tekstury objwmtl/*.png sĂ„â€¦ w nim
  //    zapisane Äąâ€şcieÄąÄ˝kami wzglĂ„â„˘dnymi do lokalizacji samego .mtl).
  const materials = await new Promise((resolve, reject) => {
    new THREE.MTLLoader().load(A321_MTL_URL, resolve, undefined,
      err => reject(_explainModelLoadError(A321_MTL_URL, err)));
  });
  materials.preload();

  // Mapa "nazwa czĂ„â„˘Äąâ€şci" Ă˘â€ â€™ gotowy materiaÄąâ€š z tĂ„â€¦ czĂ„â„˘Äąâ€şciĂ„â€¦ powiĂ„â€¦zany, wyprowadzona
  // bezpoÄąâ€şrednio z wpisÄ‚Ĺ‚w map_Kd w .mtl (np. "objwmtl/cockpit_inside.png" Ă˘â€ â€™
  // czĂ„â„˘Äąâ€şĂ„â€ˇ "cockpit_inside"). UÄąÄ˝ywamy jej jako niezawodnego planu B: nazwa
  // czĂ„â„˘Äąâ€şci w a321.obj ("o cockpit_inside") jest zawsze taka sama jak nazwa
  // pliku tekstury, wiĂ„â„˘c to dziaÄąâ€ša niezaleÄąÄ˝nie od tego, czy wewnĂ„â„˘trzne
  // dopasowanie usemtlĂ˘â€ â€ťnewmtl w OBJLoaderze siĂ„â„˘ powiedzie.
  const partNameToMaterial = {};
  for (const matName in materials.materialsInfo) {
    const mapKd = materials.materialsInfo[matName] && materials.materialsInfo[matName].map_kd;
    if (!mapKd) continue;
    const partName = mapKd.split('/').pop().replace(/\.[a-zA-Z0-9]+$/, '');
    partNameToMaterial[partName] = materials.create(matName);
  }

  // 2) Wczytaj geometriĂ„â„˘ .obj z juÄąÄ˝ przygotowanymi materiaÄąâ€šami z .mtl Ă˘â‚¬â€ť
  //    OBJLoader sam dopasuje materiaÄąâ€š do kaÄąÄ˝dej czĂ„â„˘Äąâ€şci wg "usemtl" w pliku.
  const group = await new Promise((resolve, reject) => {
    new THREE.OBJLoader()
      .setMaterials(materials)
      .load(A321_OBJ_URL, resolve, undefined,
        err => reject(_explainModelLoadError(A321_OBJ_URL, err)));
  });

  // 3) Tak jak wczeÄąâ€şniej: dwustronne renderowanie, poprawny color space tekstur,
  //    anizotropia Ă˘â‚¬â€ť i wydzielenie podwozia do osobnej grupy. Plus zabezpieczenie:
  //    jeÄąâ€şli czĂ„â„˘Äąâ€şĂ„â€ˇ nie ma tekstury (mapa siĂ„â„˘ nie dopasowaÄąâ€ša), wymuszamy jĂ„â€¦ po
  //    nazwie czĂ„â„˘Äąâ€şci z mapy zbudowanej wyÄąÄ˝ej.
  const gearGroup = new THREE.Group();
  gearGroup.name = 'gearGroup';
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  for (const child of [...group.children]) {
    const fallbackMat = partNameToMaterial[child.name];
    child.traverse(node => {
      if (!node.isMesh) return;
      node.castShadow = true;
      const hasMap = node.material && !Array.isArray(node.material) && node.material.map;
      if (!hasMap && fallbackMat) {
        node.material = fallbackMat;
        console.warn(`[A321] "${child.name}" nie dostaÄąâ€š tekstury z OBJLoadera Ă˘â‚¬â€ť wymuszono materiaÄąâ€š po nazwie czĂ„â„˘Äąâ€şci.`);
      }
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      for (const mat of mats) {
        if (!mat) continue;
        mat.side = THREE.DoubleSide;
        if (mat.map) {
          mat.map.encoding   = THREE.sRGBEncoding;
          mat.map.anisotropy = maxAniso;
        }
        // Dodatkowy staÄąâ€šy "fill" (+20,20,20 w skali 0-255) niezaleÄąÄ˝ny od
        // oÄąâ€şwietlenia sceny Ă˘â‚¬â€ť samolot inaczej gubiÄąâ€š siĂ„â„˘ w cieniu wÄąâ€šasnym,
        // gĂ„â„˘stej mgle albo nocĂ„â€¦, gdy sunLight/hemiLight sĂ„â€¦ sÄąâ€šabe. emissive
        // dodaje staÄąâ€šĂ„â€¦ jasnoÄąâ€şĂ„â€ˇ niezaleÄąÄ˝nie od padajĂ„â€¦cego Äąâ€şwiatÄąâ€ša.
        if (mat.emissive) mat.emissive.addScalar(20 / 255);
      }
    });
    if (child.name.startsWith(A321_GEAR_PREFIX)) gearGroup.add(child); // .add() sam usuwa z poprzedniego rodzica
  }

  if (gearGroup.children.length) group.add(gearGroup);
  return group;
}

// Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬ Parametry fizyki A321 Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬

const G_ACC = 9.81;
const RHO   = 1.225;

// Reverse thrust: ok. 20% maksymalnego ciĂ„â€¦gu do przodu Ă˘â‚¬â€ť typowe dla
// wysokoprzepÄąâ€šywowych silnikÄ‚Ĺ‚w turbowentylatorowych (reverser "Äąâ€šapie" tylko
// strumieÄąâ€ž obejÄąâ€şciowy, nie caÄąâ€šy ciĂ„â€¦g silnika). Patrz reverserDeployFrac w
// physicsUpdate() Ă˘â‚¬â€ť ciĂ„â€¦g wsteczny narasta wraz z fizycznym wysuwaniem
// rewersorÄ‚Ĺ‚w, nie skokowo.
const A321_REVERSE_THRUST_FRAC = 0.20;

const A321_PARAMS = {
  mass:       75000,
  maxThrust:  280000,
  wingArea:   122.4,
  span:       35.8,
  cl0:        0.18,
  clAlpha:    5.2,
  clMax:      1.65,
  cdMin:      0.045,
  cdAlpha:    0.85,
  eOswald:    0.78,
  AR:         10.48,
  // NAPRAWA (zgÄąâ€šoszone: "przy flaps=1 ciĂ„â€¦gÄąâ€šy dryf pitch w gÄ‚Ĺ‚rĂ„â„˘, koÄąâ€žczĂ„â€¦cy siĂ„â„˘
  // gÄąâ€šĂ„â„˘bokim przeciĂ„â€¦gniĂ„â„˘ciem"): flapCl[1]=0.70 dawaÄąâ€šo przy wypuszczeniu klap
  // (flaps 0->1 w locie, przy niezmienionym alpha) nagÄąâ€šy skok siÄąâ€šy noÄąâ€şnej
  // ~525 000 N (prawie 70% ciĂ„â„˘ÄąÄ˝aru samolotu!) Ă˘â‚¬â€ť auto-trim (PITCH_TRIM_RATE)
  // jest za wolny, ÄąÄ˝eby to skompensowaĂ„â€ˇ, wiĂ„â„˘c samolot wpada w niedotÄąâ€šumiony
  // phugoid i przy tak duÄąÄ˝ym zaburzeniu ucieka w powtarzajĂ„â€¦ce siĂ„â„˘ gÄąâ€šĂ„â„˘bokie
  // przeciĂ„â€¦gniĂ„â„˘cia. 0.70 byÄąâ€šo teÄąÄ˝ fizycznie nierealistyczne dla flaps=1
  // (to najmniejsze ustawienie, odpowiednik samych slatÄ‚Ĺ‚w/maÄąâ€šego wychylenia Ă˘â‚¬â€ť
  // powinno dawaĂ„â€ˇ duÄąÄ˝o mniejszy przyrost CL niÄąÄ˝ flaps=2/3). Zweryfikowano
  // symulacyjnie (Node+three.js, replika physicsUpdate): prÄ‚Ĺ‚g niestabilnoÄąâ€şci
  // jest przy flapCl[1]Ă˘â€°Â0.30; 0.25 ma margines i nie wchodzi w przeciĂ„â€¦gniĂ„â„˘cie
  // ani przy wypuszczeniu, ani przy schowaniu klap w locie. flapCl[2]/[3] NIE
  // zmienione Ă˘â‚¬â€ť nie zgÄąâ€šoszono tam problemu, ale ten sam mechanizm (duÄąÄ˝y,
  // nagÄąâ€šy skok CL) moÄąÄ˝e teoretycznie dotyczyĂ„â€ˇ i tamtych przejÄąâ€şĂ„â€ˇ, jeÄąâ€şli kiedyÄąâ€ş
  // siĂ„â„˘ ujawni.
  flapCl:     [0.0, 0.25, 1.20, 1.80],
  flapCd:     [0.0, 0.040, 0.085, 0.160],
  flapStall:  [0.285, 0.32, 0.36, 0.40],
  cdGear:     0.060,
  groundRunThrustBoost: 2.20,
  groundRunDragScale:   0.30,
  // NAPRAWA: poprzednio 0.80 sztucznie ODEJMOWAÄąÂO 20% siÄąâ€šy noÄąâ€şnej blisko
  // ziemi Ă˘â‚¬â€ť w rzeczywistoÄąâ€şci efekt przyziemny (ground effect) siÄąâ€šĂ„â„˘ noÄąâ€şnĂ„â€¦
  // raczej lekko ZWIĂ„ÂKSZA (redukcjĂ„â„˘ oporu indukowanego blisko ziemi i tak juÄąÄ˝
  // modeluje osobno groundEffectFactor()/cdi niÄąÄ˝ej). Ta kara powodowaÄąâ€ša, ÄąÄ˝e
  // samolot fizycznie nie mÄ‚Ĺ‚gÄąâ€š wygenerowaĂ„â€ˇ doÄąâ€şĂ„â€ˇ siÄąâ€šy noÄąâ€şnej do oderwania w
  // pobliÄąÄ˝u zamierzonego Vr Ă˘â‚¬â€ť musiaÄąâ€š jechaĂ„â€ˇ duÄąÄ˝o szybciej niÄąÄ˝ powinien,
  // caÄąâ€šy czas "przyklejony" do limitu pitch (patrz GEAR_TAILSTRIKE_PITCH_LIMIT).
  groundRunLiftScale:   1.0,
  spoilerCd:  0.30,
  spoilerLiftLoss: 0.35,
  V1: 69.4, VR: 74.7, V2: 79.8, Vstall: 62, VMO: 189,
};

// Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬ Geometria i zawieszenie podwozia Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬
//
// WspÄ‚Ĺ‚Äąâ€šrzĂ„â„˘dne 3 punktÄ‚Ĺ‚w stycznoÄąâ€şci kÄ‚Ĺ‚Äąâ€š z ziemiĂ„â€¦ w LOKALNYM ukÄąâ€šadzie samolotu
// (ten sam co reszta fizyki: +X = prawe skrzydÄąâ€šo,
// +Y = gÄ‚Ĺ‚ra, +Z = dziÄ‚Ĺ‚b), w metrach wzglĂ„â„˘dem "origin" encji (this.altM/lat/lon).
// Wyznaczone bezpoÄąâ€şrednio z geometrii a321.obj (dolne punkty opon), a nie
// zgadniĂ„â„˘te Ă˘â‚¬â€ť dziĂ„â„˘ki temu naturalny kĂ„â€¦t spoczynkowy samolotu na 3 koÄąâ€šach
// wynika z samego modelu, a nie ze staÄąâ€šej "gearOffset" jak wczeÄąâ€şniej.
const GEAR_NOSE  = { x: -0.17, y: -3.53, z: 15.34 };
const GEAR_LEFT  = { x: -3.96, y: -3.75, z: -1.20 };
const GEAR_RIGHT = { x:  3.62, y: -3.75, z: -1.20 };
// PrzybliÄąÄ˝ona wysokoÄąâ€şĂ„â€ˇ "spoczynkowa" origin encji nad terenem, gdy podwozie
// stoi na pÄąâ€šaskiej ziemi Ă˘â‚¬â€ť uÄąÄ˝ywana tylko jako sensowna wysokoÄąâ€şĂ„â€ˇ startowa w
// reset() (dokÄąâ€šadny kĂ„â€¦t/wysokoÄąâ€şĂ„â€ˇ i tak dociĂ„â€¦ga siĂ„â„˘ w pierwszej klatce fizyki).
const GEAR_MAIN_REST_OFFSET = -GEAR_LEFT.y;

// Zawieszenie (amortyzacja goleni) Ă˘â‚¬â€ť na razie WYÄąÂĂ„â€žCZNIE fizyczne (wpÄąâ€šywa na
// wysokoÄąâ€şĂ„â€ˇ kadÄąâ€šuba), bez animacji ugiĂ„â„˘cia samej goleni/opony (to osobny,
// wizualny krok na pÄ‚Ĺ‚ÄąĹźniej). KaÄąÄ˝da goleÄąâ€ž ma wÄąâ€šasny, niezaleÄąÄ˝ny stan "wgniecenia".
const GEAR_SUSPENSION_TRAVEL   = 0.42; // maks. caÄąâ€škowite wgniecenie w ziemiĂ„â„˘ (m) Ă˘â‚¬â€ť od tego miejsca dochodzi dodatkowa sztywnoÄąâ€şĂ„â€ˇ "twardego zderzaka" (patrz GEAR_HARDSTOP_K_MULT)

// ZMIANA ARCHITEKTURY: zawieszenie juÄąÄ˝ NIE ma wÄąâ€šasnego, osobnego stanu
// "wgniecenia" (dawne this.gearSink/gearSinkVel) Ă˘â‚¬â€ť to byÄąâ€ša animacja BLENDOWANA
// do wyniku, a nie prawdziwa siÄąâ€ša. Teraz ugiĂ„â„˘cie to po prostu GEOMETRYCZNA
// gÄąâ€šĂ„â„˘bokoÄąâ€şĂ„â€ˇ penetracji terenu przez faktycznĂ„â€¦, aktualnĂ„â€¦ pozycjĂ„â„˘/orientacjĂ„â„˘
// samolotu (pen z sampleGear()), a siÄąâ€ša sprĂ„â„˘ÄąÄ˝ysto-tÄąâ€šumiĂ„â€¦ca liczona z niej
// WPROST (F = kĂ‚Â·pen + cĂ‚Â·prĂ„â„˘dkoÄąâ€şĂ„â€ˇ_zagÄąâ€šĂ„â„˘biania, patrz physicsUpdate) trafia do
// sumy siÄąâ€š/momentÄ‚Ĺ‚w caÄąâ€šej bryÄąâ€šy sztywnej Ă˘â‚¬â€ť tak jak w prawdziwym zawieszeniu:
// to sama sprĂ„â„˘ÄąÄ˝yna, poprzez swojĂ„â€¦ siÄąâ€šĂ„â„˘, decyduje jak samolot siĂ„â„˘ zachowuje, a
// nie osobna symulacja "na boku", ktÄ‚Ĺ‚rej wynik potem doklejamy do pitch/roll.
const GEAR_SUSP_OMEGA_MAIN     = 12.57; // rad/s Ă˘â‚¬â€ť czĂ„â„˘stoÄąâ€şĂ„â€ˇ wÄąâ€šasna zawieszenia gÄąâ€šÄ‚Ĺ‚wnego (~0.5s okresu, nietÄąâ€šumiony)
const GEAR_SUSP_ZETA_MAIN      = 0.85;  // wspÄ‚Ĺ‚Äąâ€šczynnik tÄąâ€šumienia gÄąâ€šÄ‚Ĺ‚wnego (0.85 = mocno tÄąâ€šumiony, bez widocznego odbicia)
const GEAR_SUSP_OMEGA_NOSE     = 15.0;  // rad/s Ă˘â‚¬â€ť przednie koÄąâ€šo nieco sztywniejsze/szybsze
const GEAR_SUSP_ZETA_NOSE      = 0.9;
// Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬ BryÄąâ€ša sztywna: masa, momenty bezwÄąâ€šadnoÄąâ€şci, geometria aerodynamiczna Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬
//
// KOMPLETNY REMAKE fizyki ziemia/rotacja/pitch: zamiast oddzielnych "sztucznych"
// krzywych (elevatorAuthority, timer oderwania, blendowanie kĂ„â€¦ta do terenu,
// zaciskajĂ„â€¦cy siĂ„â„˘ limit pitch) samolot jest teraz PRAWDZIWĂ„â€ž bryÄąâ€šĂ„â€¦ sztywnĂ„â€¦ Ă˘â‚¬â€ť
// kaÄąÄ˝da siÄąâ€ša (skrzydÄąâ€šo, usterzenie/ster wysokoÄąâ€şci, statecznik/ster kierunku,
// ciĂ„â€¦g, 3 punkty podwozia) jest przyÄąâ€šoÄąÄ˝ona w swoim RZECZYWISTYM miejscu
// wzglĂ„â„˘dem Äąâ€şrodka masy (CG), co razem z ramieniem daje moment (ÄŽâ€ž = rÄ‚â€”F). Suma
// momentÄ‚Ĺ‚w / moment bezwÄąâ€šadnoÄąâ€şci = przyspieszenie kĂ„â€¦towe (patrz physicsUpdate)
// Ă˘â‚¬â€ť samolot podrywa nos, bo ster wysokoÄąâ€şci FIZYCZNIE go podrywa, i odrywa siĂ„â„˘
// od ziemi, bo siÄąâ€šy w pionie FIZYCZNIE to robiĂ„â€¦, a nie bo jakiÄąâ€ş timer/prÄ‚Ĺ‚g tak
// zdecydowaÄąâ€š.
//
// DokÄąâ€šadne certyfikowane momenty bezwÄąâ€šadnoÄąâ€şci nie sĂ„â€¦ publicznie dostĂ„â„˘pne Ă˘â‚¬â€ť
// liczymy je standardowĂ„â€¦ metodĂ„â€¦ inÄąÄ˝ynierskĂ„â€¦ "promienia ÄąÄ˝yracji" (radius of
// gyration): I = masa Ä‚â€” r_ÄąÄ˝yrĂ‚Ë›, gdzie r_ÄąÄ˝yr to uÄąâ€šamek charakterystycznego
// wymiaru samolotu (kadÄąâ€šub dla pitch/yaw, rozpiĂ„â„˘toÄąâ€şĂ„â€ˇ dla roll). To
// przybliÄąÄ˝enie, ale oparte na prawdziwej geometrii A321, nie na zgadywaniu.
const A321_FUSELAGE_LEN = 44.5; // m
// UWAGA: byÄąâ€šo `const` Ă˘â‚¬â€ť teraz `let`, bo masa (a wiĂ„â„˘c i bezwÄąâ€šadnoÄąâ€şĂ„â€ˇ) moÄąÄ˝e siĂ„â„˘
// zmieniĂ„â€ˇ po Reset z nowym paliwem/payloadem (patrz recomputeInertia() i
// applyAircraftWeight() dalej w tym pliku). WzÄ‚Ĺ‚r bez zmian.
let A321_IYY = A321_PARAMS.mass * (0.25 * A321_FUSELAGE_LEN) ** 2; // pitch, ok. 9.3M kgĂ‚Â·mĂ‚Ë›
let A321_IXX = A321_PARAMS.mass * (0.23 * A321_PARAMS.span) ** 2;  // roll,  ok. 5.1M kgĂ‚Â·mĂ‚Ë›
let A321_IZZ = A321_PARAMS.mass * (0.27 * A321_FUSELAGE_LEN) ** 2; // yaw,   ok. 12.2M kgĂ‚Â·mĂ‚Ë› (obejmuje i dÄąâ€šugoÄąâ€şĂ„â€ˇ, i rozstaw mas)

// Gdzie faktycznie dziaÄąâ€šajĂ„â€¦ siÄąâ€šy aerodynamiczne, w LOKALNYM ukÄąâ€šadzie samolotu
// (ten sam co GEAR_NOSE/LEFT/RIGHT: +X prawe skrzydÄąâ€šo, +Y gÄ‚Ĺ‚ra, +Z dziÄ‚Ĺ‚b). To
// jest sedno "prawdziwej fizyki": ster wysokoÄąâ€şci nie "ustawia pitchRate"
// bezpoÄąâ€şrednio Ă˘â‚¬â€ť wytwarza siÄąâ€šĂ„â„˘ W TYM miejscu, daleko za CG, i to WÄąÂAÄąĹˇNIE
// ramiĂ„â„˘ (TAIL_AC.z) zamienia tĂ„â„˘ siÄąâ€šĂ„â„˘ w moment obracajĂ„â€¦cy caÄąâ€šy samolot.
const WING_AC   = { x: 0, y: 0,   z: 0.4   }; // Äąâ€şrodek parcia skrzydÄąâ€ša Ă˘â‚¬â€ť bardzo blisko CG (byÄąâ€šo 1.2m Ă˘â‚¬â€ť patrz NAPRAWA przy THRUST_PT, ten sam powod: zbyt duÄąÄ˝y moment pitch-up przy typowej sile noÄąâ€şnej Ă˘â€°ÂciĂ„â„˘ÄąÄ˝arowi)
const TAIL_AC   = { x: 0, y: 0.4, z: -17.5 }; // usterzenie poziome + ster wysokoÄąâ€şci Ă˘â‚¬â€ť daleko za CG
const FIN_AC    = { x: 0, y: 2.2, z: -17.0 }; // statecznik pionowy + ster kierunku Ă˘â‚¬â€ť za CG, podniesiony (stĂ„â€¦d sprzĂ„â„˘ÄąÄ˝enie z rollem)
// NAPRAWA (zgÄąâ€šoszone: "samolot stale przechyla siĂ„â„˘ do tyÄąâ€šu"): silnik pod CG
// (THRUST_PT.y<0) daje moment pitch-up proporcjonalny do ciĂ„â€¦gu Ă˘â‚¬â€ť realny
// efekt ("power pitch coupling"), ale ramiĂ„â„˘ 1.6m w poÄąâ€šĂ„â€¦czeniu z 2.2Ä‚â€” mnoÄąÄ˝nikiem
// ciĂ„â€¦gu na ziemi (groundRunThrustBoost Ă˘â‚¬â€ť czysto growplayowe wzmocnienie
// przyspieszenia, NIE prawdziwy wzrost mocy silnikÄ‚Ĺ‚w) dawaÄąâ€šo moment zbliÄąÄ˝ajĂ„â€¦cy
// siĂ„â„˘ do granicy, jakĂ„â€¦ mogÄąâ€šo skompensowaĂ„â€ˇ przednie koÄąâ€šo Ă˘â‚¬â€ť przy wiĂ„â„˘kszej
// przepustnicy nos unosiÄąâ€š siĂ„â„˘ SAM, bez udziaÄąâ€šu pilota. RamiĂ„â„˘ zmniejszone, a
// moment liczony teraz z NIEPODBITEGO ciĂ„â€¦gu (patrz physicsUpdate) Ă˘â‚¬â€ť realne
// "power pitch" zostaje, ale nie przytÄąâ€šacza juÄąÄ˝ geometrii podwozia.
const THRUST_PT = { x: 0, y: -0.4, z: 0    }; // silniki pod skrzydÄąâ€šami Ă˘â‚¬â€ť poniÄąÄ˝ej CG (ramiĂ„â„˘ zmniejszone z -1.6, patrz NAPRAWA wyÄąÄ˝ej)

// Bazowe (fabryczne, przy DOMYÄąĹˇLNYM zaÄąâ€šadowaniu Ă˘â‚¬â€ť patrz A321_DEFAULT_FUEL_KG/
// A321_DEFAULT_PAYLOAD_KG niÄąÄ˝ej) pozycje Z powyÄąÄ˝szych punktÄ‚Ĺ‚w, zanim CG siĂ„â„˘
// przesunie. applyAircraftWeight() mutuje WING_AC.z/TAIL_AC.z/FIN_AC.z/
// THRUST_PT.z WZGLĂ„ÂDEM tych baz Ă˘â‚¬â€ť same obiekty zostajĂ„â€¦ te same (przez
// referencjĂ„â„˘), wiĂ„â„˘c kaÄąÄ˝de miejsce w pliku, ktÄ‚Ĺ‚re czyta np. TAIL_AC.z, widzi
// automatycznie aktualnĂ„â€¦, przesuniĂ„â„˘tĂ„â€¦ wartoÄąâ€şĂ„â€ˇ bez ÄąÄ˝adnych dodatkowych zmian.
const WING_AC_BASE_Z   = WING_AC.z;
const TAIL_AC_BASE_Z   = TAIL_AC.z;
const FIN_AC_BASE_Z    = FIN_AC.z;
const THRUST_PT_BASE_Z = THRUST_PT.z;

// Jak mocno wychylenie powierzchni sterowej wpÄąâ€šywa na siÄąâ€šĂ„â„˘ aerodynamicznĂ„â€¦ Ă˘â‚¬â€ť
// prawdziwe (choĂ„â€ˇ przybliÄąÄ˝one) wspÄ‚Ĺ‚Äąâ€šczynniki aerodynamiczne, nie "krzywe
// autorytetu" dopasowane pod konkretne odczucie sterowania.
const ELEVATOR_MAX_RAD    = 0.35; // rad, ~20Ă‚Â° maks. wychylenia steru wysokoÄąâ€şci
const ELEVATOR_CL_PER_RAD = 3.0;  // dCL/dĂŽÂ´e usterzenia poziomego
const TAIL_AREA           = 31.0; // mĂ‚Ë› powierzchnia usterzenia poziomego
// NAPRAWA (zgÄąâ€šoszone: "prÄ‚Ĺ‚bujĂ„â„˘ lecieĂ„â€ˇ w dÄ‚Ĺ‚Äąâ€š, a samolot bardzo mocno chce
// wrÄ‚Ĺ‚ciĂ„â€ˇ w gÄ‚Ĺ‚rĂ„â„˘ Ă˘â‚¬â€ť w powietrzu pitch nie powinien siĂ„â„˘ prawie zmieniaĂ„â€ˇ sam"):
// jeden wspÄ‚Ĺ‚lny TAIL_CL_ALPHA (3.3) byÄąâ€š uÄąÄ˝ywany JEDNOCZEÄąĹˇNIE do (a) siÄąâ€šy
// przywracajĂ„â€¦cej kĂ„â€¦t natarcia do wartowoÄąâ€şci trymu (statyczna statecznoÄąâ€şĂ„â€ˇ Ă˘â‚¬â€ť
// to WÄąÂAÄąĹˇNIE to "samo wraca w gÄ‚Ĺ‚rĂ„â„˘") i (b) tÄąâ€šumienia PRĂ„ÂDKOÄąĹˇCI kĂ„â€¦towej
// pitch (przez czÄąâ€šon z pitchRate w tailAlpha niÄąÄ˝ej). To DWIE rÄ‚Ĺ‚ÄąÄ˝ne rzeczy:
// (a) to "sprĂ„â„˘ÄąÄ˝yna" ciĂ„â€¦gnĂ„â€¦ca kĂ„â€¦t z powrotem do trymu (silny efekt =
// realistyczne, ale tu niechciane "samoczynne" prostowanie pitch), a (b) to
// "tÄąâ€šumik" gaszĂ„â€¦cy oscylacje BEZ ciĂ„â€¦gniĂ„â„˘cia do konkretnego kĂ„â€¦ta. Rozdzielone
// na dwa niezaleÄąÄ˝ne wspÄ‚Ĺ‚Äąâ€šczynniki: STATIC drastycznie zmniejszony (sÄąâ€šaba,
// prawie neutralna statecznoÄąâ€şĂ„â€ˇ Ă˘â‚¬â€ť pchniĂ„â„˘ty w dÄ‚Ĺ‚Äąâ€š nos zostaje w dole zamiast
// odbijaĂ„â€ˇ siĂ„â„˘ z powrotem), RATE zostaje bez zmian (peÄąâ€šne tÄąâ€šumienie oscylacji,
// plus PITCH_DAMPING_GAIN niÄąÄ˝ej Ă˘â‚¬â€ť to nadal dziaÄąâ€ša niezaleÄąÄ˝nie od tej zmiany).
// Zweryfikowane numerycznie: STATIC=0.7 daje ĂŽÂ¶Ă˘â€°Â1.75 (przetÄąâ€šumiony, bez
// oscylacji) i bardzo sÄąâ€šabĂ„â€¦, ale wciĂ„â€¦ÄąÄ˝ BEZPIECZNIE dodatniĂ„â€¦ (stabilnĂ„â€¦)
// sztywnoÄąâ€şĂ„â€ˇ powrotu do trymu na kaÄąÄ˝dej prĂ„â„˘dkoÄąâ€şci Ă˘â‚¬â€ť poniÄąÄ˝ej ok. 0.3 ukÄąâ€šad
// staje siĂ„â„˘ niestabilny (nie zmniejszaj poniÄąÄ˝ej tej wartoÄąâ€şci bez ponownej
// weryfikacji).
const TAIL_CL_ALPHA_STATIC = 0.7;  // 1/rad Ă˘â‚¬â€ť siÄąâ€ša "powrotu do trymu" (Äąâ€şwiadomie sÄąâ€šaba, patrz wyÄąÄ˝ej)
const TAIL_CL_ALPHA_RATE   = 3.3;  // 1/rad Ă˘â‚¬â€ť tÄąâ€šumienie prĂ„â„˘dkoÄąâ€şci pitch (jak wczeÄąâ€şniej, bez zmian)

const RUDDER_MAX_RAD    = 0.35;
const RUDDER_CL_PER_RAD = 2.4;
const FIN_AREA          = 21.0; // mĂ‚Ë›
const FIN_CL_BETA       = 2.0;  // 1/rad Ă˘â‚¬â€ť statecznoÄąâ€şĂ„â€ˇ kierunkowa ("efekt chorĂ„â€¦giewki")
// NAPRAWA (zgÄąâ€šoszone: "po skrĂ„â„˘caniu lub uÄąÄ˝yciu ruddera heading zaczyna
// oscylowaĂ„â€ˇ Ă˘â‚¬â€ť samolot sie caÄąâ€šy czas obraca lewo prawo, heading bez roll"):
// naturalne tÄąâ€šumienie yaw (z samego czÄąâ€šonu rate w finBeta) okazaÄąâ€šo siĂ„â„˘ zbyt
// sÄąâ€šabe Ă˘â‚¬â€ť dawaÄąâ€šo bardzo wolno gasnĂ„â€¦cy "dutch roll" (klasyczny, sprzĂ„â„˘ÄąÄ˝ony
// tryb yaw+roll w samolotach) trwajĂ„â€¦cy 50+ sekund po kaÄąÄ˝dym skrĂ„â„˘cie/ruderze.
// Ten sam pomysÄąâ€š co PITCH_DAMPING_GAIN wyÄąÄ˝ej: dodatkowy, jawny czÄąâ€šon
// tÄąâ€šumiĂ„â€¦cy niezaleÄąÄ˝ny od statecznika kierunkowego. Zweryfikowane
// symulacyjnie (Node, impuls rudder + puszczenie): bez tego heading osiada
// poniÄąÄ˝ej 1Ă‚Â° dopiero po ~50s, z tym Ă˘â‚¬â€ť po ~20s.
const YAW_DAMPING_GAIN  = 0.4;

const AILERON_MAX_RAD    = 0.30;
const AILERON_CL_PER_RAD = 0.09; // moment przechylajĂ„â€¦cy jako wspÄ‚Ĺ‚Äąâ€šczynnik bezwymiarowy (mnoÄąÄ˝ony przez qĂ‚Â·SĂ‚Â·rozpiĂ„â„˘toÄąâ€şĂ„â€ˇ)
const ROLL_DAMPING_GAIN  = 0.35; // tÄąâ€šumienie przechylenia (odpowiednik Clp)
// Dodatkowe tÄąâ€šumienie pitch (odpowiednik Cmq spoza samego sprzĂ„â„˘ÄąÄ˝enia
// kĂ„â€¦t-natarcia-usterzenia-z-pitchRate, patrz tailAlpha niÄąÄ˝ej) Ă˘â‚¬â€ť realne
// samoloty majĂ„â€¦ wiĂ„â„˘cej ÄąĹźrÄ‚Ĺ‚deÄąâ€š tÄąâ€šumienia pitch (kadÄąâ€šub, spÄ‚Ĺ‚ÄąĹźnienie downwash,
// same skrzydÄąâ€šo), ktÄ‚Ĺ‚rych nie modelujemy osobno. Bez tego czÄąâ€šonu ukÄąâ€šad byÄąâ€š
// wyraÄąĹźnie niedotÄąâ€šumiony: zmierzone numerycznie ĂŽÂ¶Ă˘â€°Â0.10 (staÄąâ€še na kaÄąÄ˝dej
// prĂ„â„˘dkoÄąâ€şci) Ă˘â‚¬â€ť oscylacje o okresie kilku-kilkunastu sekund gasnĂ„â€¦ce bardzo
// wolno, wÄąâ€šaÄąâ€şnie takie jak zgÄąâ€šoszone "dziwne oscylacje pitch". WartoÄąâ€şĂ„â€ˇ 1.0
// podnosi ĂŽÂ¶ do ok. 0.5 (wygodne, zbliÄąÄ˝one do typowych airlinierÄ‚Ĺ‚w) Ă˘â‚¬â€ť
// zweryfikowane numerycznie, staÄąâ€še na kaÄąÄ˝dej prĂ„â„˘dkoÄąâ€şci.
const PITCH_DAMPING_GAIN = 1.0;
// NAPRAWA v3 (zgÄąâ€šoszone: "pitch dĂ„â€¦ÄąÄ˝y zawsze do jakiegoÄąâ€ş kata zaleÄąÄ˝nego od
// klap [ok. 5Ă‚Â°/6Ă‚Â°/9Ă‚Â°/10Ă‚Â° dla flaps 0/1/2/3], niewaÄąÄ˝ne co ustawiĂ„â„˘ Ă˘â‚¬â€ť chcĂ„â„˘
// ÄąÄ˝eby trzymaÄąâ€š DOKÄąÂADNIE ten kĂ„â€¦t/AoA, ktÄ‚Ĺ‚ry mu nadam inputem"): PITCH_TRIM_RATE
// (wersja v2 wyÄąÄ˝ej) nadal nie byÄąâ€š wÄąâ€šaÄąâ€şciwym mechanizmem Ă˘â‚¬â€ť choĂ„â€ˇ szybszy, wciĂ„â€¦ÄąÄ˝
// tylko "gonil" pitchRate=0, co NIE gwarantuje utrzymania KONKRETNEGO kĂ„â€¦ta:
// gdy pitchRate osiada w zerze, caÄąâ€ša reszta ukÄąâ€šadu (prĂ„â„˘dkoÄąâ€şĂ„â€ˇ, kĂ„â€¦t Äąâ€şcieÄąÄ˝ki
// lotu) i tak dalej dryfuje do JEDYNEJ, naturalnej rÄ‚Ĺ‚wnowagi wyznaczonej przez
// throttle+klapy Ă˘â‚¬â€ť stĂ„â€¦d zawsze ten sam kĂ„â€¦t "docelowy", niezaleÄąÄ˝nie od tego,
// co pilot ustawiÄąâ€š drazkiem. To co jest naprawdĂ„â„˘ potrzebne, to PRAWDZIWE
// "attitude hold": kiedy pilot puszcza drĂ„â€¦ÄąÄ˝ek, ukÄąâ€šad ma aktywnie UTRZYMYWAĂ„â€ 
// dokÄąâ€šadnie ten kĂ„â€¦t pitch, w ktÄ‚Ĺ‚rym go zostawiÄąâ€š Ă˘â‚¬â€ť dokÄąâ€šadnie tak dziaÄąâ€ša
// prawdziwy A320/A321 fly-by-wire (prawo normalne pitch): neutralny sidestick
// = utrzymuj BIEÄąÄ˝Ă„â€žCĂ„â€ž Äąâ€şcieÄąÄ˝kĂ„â„˘ lotu/pitch, nie wracaj do jakiegoÄąâ€ş staÄąâ€šego kĂ„â€¦ta.
//
// Implementacja: this.pitchHoldTarget (patrz konstruktor/reset) to kĂ„â€¦t, ktÄ‚Ĺ‚ry
// aktualnie ma byĂ„â€ˇ utrzymywany. Gdy pilot trzyma wyraÄąĹźny input pitch, target
// NA BIEÄąÄ˝Ă„â€žCO podĂ„â€¦ÄąÄ˝a za aktualnym pitchRad (ÄąÄ˝eby w momencie puszczenia "zÄąâ€šapaĂ„â€ˇ"
// dokÄąâ€šadnie tam, gdzie pilot go zostawiÄąâ€š). Gdy input jest bliski zeru, regulator
// PD (proporcjonalno-rÄ‚Ĺ‚ÄąÄ˝niczkowy) koryguje pitchTrim na podstawie:
// (a) bÄąâ€šĂ„â„˘du kĂ„â€¦ta (pitchRad - pitchHoldTarget) Ă˘â‚¬â€ť czÄąâ€šon P,
// (b) bieÄąÄ˝Ă„â€¦cej prĂ„â„˘dkoÄąâ€şci kĂ„â€¦towej pitch (pitchRate) Ă˘â‚¬â€ť czÄąâ€šon D (tÄąâ€šumi ruch
//     W KIERUNKU odejscia od celu, niezaleÄąÄ˝nie od aktualnego bÄąâ€šĂ„â„˘du).
// UWAGA NA ZNAK: zwiĂ„â„˘kszanie pitchTrim daje moment NOS-W-DÄ‚â€śÄąÂ (bo usterzenie
// jest za CG, patrz TAIL_AC.z<0) Ă˘â‚¬â€ť wiĂ„â„˘c gdy pitch jest ZA WYSOKO wzglĂ„â„˘dem
// celu (bÄąâ€šĂ„â€¦d dodatni) lub roÄąâ€şnie (pitchRate dodatnie), trym musi ROSNĂ„â€žĂ„â€ , nie
// maleĂ„â€ˇ. Pierwsza prÄ‚Ĺ‚ba implementacji miaÄąâ€ša ten znak odwrotnie i koÄąâ€žczyÄąâ€ša
// siĂ„â„˘ peÄąâ€šnym przewrotem samolotu w kaÄąÄ˝dym tekÄąâ€şcie Ă˘â‚¬â€ť poprawiony znak
// zweryfikowany numerycznie (Node+three.js) w obu kierunkach.
//
// Zweryfikowane symulacyjnie na realistycznym manewrze (pilot pociĂ„â€¦ga drĂ„â€¦ÄąÄ˝ek
// na 2s do rÄ‚Ĺ‚ÄąÄ˝nych kĂ„â€¦tÄ‚Ĺ‚w, puszcza, obserwacja 238s = ponad 2 okresy phugoidu,
// wszystkie 4 ustawienia klap): KP=0.1, KD=0.1 trzyma zadany kĂ„â€¦t w granicach
// ok. 2Ă‚Â° bez dryfu i bez oscylacji. WyÄąÄ˝sze wzmocnienia (KPĂ˘â€°Ä„0.2) zaczynajĂ„â€¦
// sprzĂ„â„˘gaĂ„â€ˇ siĂ„â„˘ z naturalnym (wolnym, ~90-100s) phugoidem samolotu i przy
// KP=0.3 ukÄąâ€šad staje siĂ„â„˘ niestabilny (ucieczka w przeciĂ„â€¦gniĂ„â„˘cie) Ă˘â‚¬â€ť 0.1 ma
// solidny margines poniÄąÄ˝ej tej granicy.
// NAPRAWA v4 (zgÄąâ€šoszone: "jak puszczĂ„â„˘ sterowanie to pitch lata gÄ‚Ĺ‚ra-dÄ‚Ĺ‚Äąâ€š od
// -15 do +30 stopni" Ă˘â‚¬â€ť uporczywa oscylacja zamiast trzymania kĂ„â€¦ta): KP=0.1/
// KD=0.1 dziaÄąâ€šaÄąâ€šo poprawnie TYLKO w moich wczeÄąâ€şniejszych testach, bo tam
// "puszczenie" zawsze nastĂ„â„˘powaÄąâ€šo po tym, jak pitchRate juÄąÄ˝ zdĂ„â€¦ÄąÄ˝yÄąâ€š opaÄąâ€şĂ„â€ˇ
// blisko zera. W realnej grze pilot puszcza drĂ„â€¦ÄąÄ˝ek W TRAKCIE aktywnego
// obrotu (np. pitchRate=13Ă‚Â°/s w chwili puszczenia to normalna sytuacja przy
// szybszym pociĂ„â€¦gniĂ„â„˘ciu) Ă˘â‚¬â€ť samolot ma wtedy bezwÄąâ€šadnoÄąâ€şĂ„â€ˇ (moment I_YY jest
// duÄąÄ˝y) i "przelatuje" znacznie dalej niÄąÄ˝ pitchHoldTarget zÄąâ€šapany w tamtej
// chwili, zanim regulator zdĂ„â€¦ÄąÄ˝y to zahamowaĂ„â€ˇ. Przy zbyt maÄąâ€šym czÄąâ€šonie D
// (KD=0.1) to przestrzelenie nie byÄąâ€šo wystarczajĂ„â€¦co tÄąâ€šumione i ukÄąâ€šad wpadaÄąâ€š
// w trwaÄąâ€šĂ„â€¦, praktycznie niegasnĂ„â€¦cĂ„â€¦ oscylacjĂ„â„˘ (sprzĂ„â„˘gniĂ„â„˘cie z naturalnym,
// sÄąâ€šabo tÄąâ€šumionym phugoidem samolotu) zamiast jednorazowego przestrzelenia.
//
// Zweryfikowane symulacyjnie (Node+three.js) na REALISTYCZNYM scenariuszu
// (puszczenie drĂ„â€¦ÄąÄ˝ka W TRAKCIE obrotu, nie po jego ustaniu, z rÄ‚Ĺ‚ÄąÄ˝nymi siÄąâ€šami/
// czasami pociĂ„â€¦gniĂ„â„˘cia, na wszystkich 4 ustawieniach klap): znacznie wyÄąÄ˝szy
// KD (1.5) wzglĂ„â„˘dem KP (0.05) tÄąâ€šumi to przestrzelenie do jednorazowego,
// szybko gasnĂ„â€¦cego "nadstrzelenia" o kilka stopni zamiast trwaÄąâ€šej oscylacji
// Ă˘â‚¬â€ť sprawdzone na 300s ciĂ„â€¦gÄąâ€šej symulacji (pitch osiada na staÄąâ€še, pitchRate
// spada do ~0.00Ă‚Â°/s, bez najmniejszego Äąâ€şladu "polowania"). WyÄąÄ˝szy KD ma sens
// fizycznie: bezwÄąâ€šadnoÄąâ€şĂ„â€ˇ samolotu (I_YY) jest duÄąÄ˝a, wiĂ„â„˘c tÄąâ€šumienie musi byĂ„â€ˇ
// odpowiednio silne wzglĂ„â„˘dem czÄąâ€šonu pozycyjnego, inaczej ukÄąâ€šad jest
// niedotÄąâ€šumiony (klasyczny problem regulatora PD przy duÄąÄ˝ej bezwÄąâ€šadnoÄąâ€şci).
// NAPRAWA v5 (zgÄąâ€šoszone: "ustawiam pitch na 15, puszczam Ă˘â‚¬â€ť spada, potem
// powoli wraca, trzeba kilka prÄ‚Ĺ‚b"): KP=0.05/KD=1.5 byÄąâ€šo za sÄąâ€šabe wzglĂ„â„˘dem
// rzeczywistej bezwÄąâ€šadnoÄąâ€şci/skali zaburzenia przy puszczeniu drazka w
// trakcie aktywnego obrotu Ă˘â‚¬â€ť regulator POPRAWNIE kierunkowo koryguje
// (P i D dziaÄąâ€šajĂ„â€¦ we wÄąâ€šaÄąâ€şciwym kierunku, zweryfikowane), ale zbyt wolno,
// wiĂ„â„˘c samolot zdĂ„â€¦ÄąÄ˝yÄąâ€š "przelecieĂ„â€ˇ" kilka stopni obok celu, zanim korekta
// zdĂ„â€¦ÄąÄ˝yÄąâ€ša zadziaÄąâ€šaĂ„â€ˇ Ă˘â‚¬â€ť stĂ„â€¦d wraÄąÄ˝enie "spada, potem wraca".
//
// PRÄ‚â€śBA ÄąĹˇLEPA, KTÄ‚â€śRA NIE ZADZIAÄąÂAÄąÂA: "snap" trymu w chwili puszczenia,
// majĂ„â€¦cy zachowaĂ„â€ˇ CIĂ„â€žGÄąÂOÄąĹˇĂ„â€  elevatorDeflection (przejĂ„â€¦Ă„â€ˇ natychmiast
// wychylenie trzymane przez pilota). To pogorszyÄąâ€šo sprawĂ„â„˘ drastycznie Ă˘â‚¬â€ť
// zachowywaÄąâ€šo peÄąâ€šne wychylenie "ciĂ„â€¦gniĂ„â„˘cia" (np. -20Ă‚Â° przy peÄąâ€šnym input)
// JUÄąÂ» PO puszczeniu drazka, wiĂ„â„˘c samolot dalej dostawaÄąâ€š ten sam silny
// moment nos-w-gÄ‚Ĺ‚rĂ„â„˘ zamiast siĂ„â„˘ zatrzymaĂ„â€ˇ Ă˘â‚¬â€ť pitch leciaÄąâ€š jeszcze wyÄąÄ˝ej
// zamiast siĂ„â„˘ ustabilizowaĂ„â€ˇ. WNIOSEK: ciĂ„â€¦gÄąâ€šoÄąâ€şĂ„â€ˇ elevatorDeflection na
// przejÄąâ€şciu NIE jest poÄąÄ˝Ă„â€¦dana Ă˘â‚¬â€ť to naturalne i poprawne, ÄąÄ˝e moment
// gwaÄąâ€štownie maleje po puszczeniu (pilot juÄąÄ˝ nie ÄąÄ˝Ă„â€¦da aktywnej rotacji).
//
// WÄąÂAÄąĹˇCIWA NAPRAWA: zostawiĂ„â€ˇ mechanizm "zÄąâ€šapania" celu bez zmian, ale
// znaczĂ„â€¦co podnieÄąâ€şĂ„â€ˇ OBA wzmocnienia (KP i KD razem, w mniej wiĂ„â„˘cej staÄąâ€šej
// proporcji ~1:5), ÄąÄ˝eby korekta byÄąâ€ša szybsza. Zweryfikowane symulacyjnie
// (Node+three.js) na wielu scenariuszach naraz: (1) puszczenie w trakcie
// aktywnego obrotu przy rÄ‚Ĺ‚ÄąÄ˝nej sile/czasie pociĂ„â€¦gniĂ„â„˘cia, (2) dÄąâ€šugi lot
// hands-off z niedoskonaÄąâ€šym trymem startowym (pierwszy zgÄąâ€šoszony bug), (3)
// duÄąÄ˝e dt (0.05s, symulacja spadku FPS) Ă˘â‚¬â€ť KP=3.0/KD=15.0 daje przestrzelenie
// rzĂ„â„˘du 2Ă‚Â° (zamiast 5-8Ă‚Â°) i dokÄąâ€šadnĂ„â€¦ zbieÄąÄ˝noÄąâ€şĂ„â€ˇ do zÄąâ€šapanego celu na
// wszystkich 4 ustawieniach klap, bez oznak niestabilnoÄąâ€şci nawet przy
// wzmocnieniach kilkukrotnie wyÄąÄ˝szych (testowane do KP=10/KD=30 Ă˘â‚¬â€ť nadal
// stabilne, wiĂ„â„˘c KP=3/KD=15 ma spory margines, nie jest granicĂ„â€¦).
const PITCH_HOLD_KP = 0.2;  // NAPRAWA v6: obnizone z 3.0, patrz komentarz nizej
const PITCH_HOLD_KD = 60.0; // NAPRAWA v6: podniesione z 15.0, patrz komentarz nizej

// Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬ Autopilot Ă˘â‚¬â€ť staÄąâ€še regulatorÄ‚Ĺ‚w Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬
// UWAGA: to sĂ„â€¦ rozsĂ„â€¦dne wartoÄąâ€şci startowe, NIE finalnie dostrojone (w
// przeciwieÄąâ€žstwie do PITCH_HOLD_KP/KD wyÄąÄ˝ej, ktÄ‚Ĺ‚re przeszÄąâ€šy wielorundowe
// strojenie na ÄąÄ˝ywo). OÄąâ€ş ALT/V-S celowo korzysta z ISTNIEJĂ„â€žCEGO,
// sprawdzonego regulatora PD (pitchHoldTarget + PITCH_HOLD_KP/KD) jako pĂ„â„˘tli
// wewnĂ„â„˘trznej Ă˘â‚¬â€ť autopilot tylko przelicza jaki kĂ„â€¦t pochylenia jest potrzebny.
// JeÄąâ€şli po testach coÄąâ€ş lata "nerwowo" albo za wolno, to WÄąÂAÄąĹˇNIE te staÄąâ€še
// warto skanowaĂ„â€ˇ/dostrajaĂ„â€ˇ w pierwszej kolejnoÄąâ€şci Ă˘â‚¬â€ť dokÄąâ€šadnie tak jak
// PITCH_HOLD_KP/KD byÄąâ€šo stopniowo dostrajane wczeÄąâ€şniej.
const AP_MANUAL_OVERRIDE_DEADZONE = 0.05; // prÄ‚Ĺ‚g wejÄąâ€şcia pilota, ktÄ‚Ĺ‚ry rozÄąâ€šĂ„â€¦cza danĂ„â€¦ oÄąâ€ş AP

// OÄąâ€ş pochylenia: ALT error -> V/S cel -> (integrator) -> cel pitch -> istniejĂ„â€¦cy PD
const AP_ALT_KP          = 0.04;               // bÄąâ€šĂ„â€¦d wysokoÄąâ€şci [m] -> V/S cel [m/s]
const AP_MAX_VS_MS       = Units.fpmToMs(1800); // limit V/S komenderowanej przez AP (Äąâ€šagodniej niÄąÄ˝ rĂ„â„˘czne manewry)
const AP_VS_TO_PITCH_KI  = 0.0025;              // integrator: rad/s celu pitch na (m/s bÄąâ€šĂ„â„˘du V/S)
const AP_MAX_PITCH_RAD   = 15 * Math.PI / 180;  // bezpieczny zakres celu pitch z autopilota

// OÄąâ€ş przechylenia: HDG error -> bank cel -> PD na bÄąâ€šĂ„â„˘dzie banku -> "wychyÄąâ€š lotki"
const AP_MAX_BANK_DEG = 25;   // maks. przechylenie komenderowane przez AP (standardowy limit AP na liniowcach)
const AP_HDG_KP       = 1.0;  // stopieÄąâ€ž banku na stopieÄąâ€ž bÄąâ€šĂ„â„˘du kursu (przyciĂ„â„˘te do AP_MAX_BANK_DEG)
const AP_ROLL_KP      = 1.2;  // "wychyÄąâ€š lotki" na rad bÄąâ€šĂ„â„˘du banku
const AP_ROLL_KD      = 0.5;  // tÄąâ€šumienie po rollRate

// Autothrust: SPD error -> throttle (P+I, integrator eliminuje offset np. od wiatru/wagi)
const AP_SPD_KP = 0.006; // throttle na kt bÄąâ€šĂ„â„˘du prĂ„â„˘dkoÄąâ€şci
const AP_SPD_KI = 0.0008; // throttle/s na kt bÄąâ€šĂ„â„˘du (caÄąâ€ška, z ograniczeniem nawiniĂ„â„˘cia niÄąÄ˝ej)
const AP_ATHR_INTEGRAL_MAX = 0.35;

const NOSEWHEEL_MAX_RAD  = 0.90; // maks. skret przedniego kola (~50st) - skutecznosc spada z predkoscia, patrz groundSteerTrackFactor()
// NAPRAWA v6 (zgÄąâ€šoszone: "ustawiam pitch na 10, leci do ~12, potem do ~8,
// potem do 10 i tam zostaje Ă˘â‚¬â€ť chcĂ„â„˘ zeby po prostu doszlo do ~12 i tam
// zostalo, bez zawracania"): KP=3.0/KD=15.0 bylo nadal wyraznie niedotlumione
// (~2 stopnie przelotu w obie strony), mimo ze prosty licznik zmian znaku
// tego nie wykryl (blad metodologiczny w mojej wczesniejszej analizie).

// Podwozie: sztywnoÄąâ€şĂ„â€ˇ/tÄąâ€šumienie zawieszenia jako PRAWDZIWE siÄąâ€šy sprĂ„â„˘ÄąÄ˝ysto-
// -tÄąâ€šumiĂ„â€¦ce, liczone wprost z geometrycznej gÄąâ€šĂ„â„˘bokoÄąâ€şci penetracji terenu przez
// FAKTYCZNĂ„â€ž pozycjĂ„â„˘/orientacjĂ„â„˘ bryÄąâ€šy sztywnej (patrz komentarz przy
// GEAR_SUSP_OMEGA_MAIN niÄąÄ˝ej). Klasyczna metoda projektowania zawieszeÄąâ€ž
// "quarter-car": k = m_naroÄąÄ˝nikaĂ‚Â·ÄŽâ€°Ă‚Ë›, c = 2ĂŽÂ¶ÄŽâ€°Ă‚Â·m_naroÄąÄ˝nika, gdzie "masa
// naroÄąÄ˝nika" to udziaÄąâ€š masy samolotu przypadajĂ„â€¦cy na danĂ„â€¦ goleÄąâ€ž.
const GEAR_LOAD_SHARE_NOSE = 0.08; // typowy udziaÄąâ€š przedniego koÄąâ€ša w ciĂ„â„˘ÄąÄ˝arze samolotu
const GEAR_LOAD_SHARE_MAIN = 0.46; // kaÄąÄ˝de koÄąâ€šo gÄąâ€šÄ‚Ĺ‚wne (2Ä‚â€”0.46 + 0.08 = 1.0)
// UWAGA: byÄąâ€šo `const` Ă˘â‚¬â€ť teraz `let`, przeliczane w recomputeGearStiffness()
// gdy zmieni siĂ„â„˘ masa (patrz applyAircraftWeight() niÄąÄ˝ej). Wzory bez zmian.
let GEAR_K_NOSE = A321_PARAMS.mass * GEAR_LOAD_SHARE_NOSE * GEAR_SUSP_OMEGA_NOSE ** 2;
let GEAR_C_NOSE = 2 * GEAR_SUSP_ZETA_NOSE * GEAR_SUSP_OMEGA_NOSE * A321_PARAMS.mass * GEAR_LOAD_SHARE_NOSE;
let GEAR_K_MAIN = A321_PARAMS.mass * GEAR_LOAD_SHARE_MAIN * GEAR_SUSP_OMEGA_MAIN ** 2;
let GEAR_C_MAIN = 2 * GEAR_SUSP_ZETA_MAIN * GEAR_SUSP_OMEGA_MAIN * A321_PARAMS.mass * GEAR_LOAD_SHARE_MAIN;

// Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬ Waga samolotu: paliwo + payload Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬
// Realistyczne wartoÄąâ€şci dla A321-200 (silniki CFM56). ÄąÄ…rÄ‚Ĺ‚dÄąâ€šo: publicznie znane
// dane producenta/operatorÄ‚Ĺ‚w, zaokrĂ„â€¦glone do rozsĂ„â€¦dnych wartoÄąâ€şci gry:
//   OEW (Operating Empty Weight, samolot pusty)         Ă˘â€°Â 48 500 kg
//   Max paliwo (zbiorniki skrzydÄąâ€šowe + centralny)        Ă˘â€°Â 23 700 kg
//   Max payload (pasaÄąÄ˝erowie + bagaÄąÄ˝ + cargo)            Ă˘â€°Â 22 000 kg
//   MTOW (Max Takeoff Weight)                            Ă˘â€°Â 93 500 kg
// UWAGA: OEW + max_paliwo + max_payload = 94 200 kg > MTOW Ă˘â‚¬â€ť czyli da siĂ„â„˘
// wybraĂ„â€ˇ suwakami kombinacjĂ„â„˘ przekraczajĂ„â€¦cĂ„â€¦ MTOW (tak jak w prawdziwym
// samolocie Ă˘â‚¬â€ť dlatego loadsheet/dyspozytor w ogÄ‚Ĺ‚le sprawdza tĂ„â„˘ sumĂ„â„˘). Patrz
// applyAircraftWeight(): masa jest wtedy TWARDO ograniczona do MTOW.
//
// DomyÄąâ€şlne fuel/payload dobrane tak, ÄąÄ˝e OEW+fuel+payload = DOKÄąÂADNIE
// dotychczasowa masa (75 000 kg) Ă˘â‚¬â€ť przy ustawieniach domyÄąâ€şlnych fizyka
// zachowuje siĂ„â„˘ identycznie jak przed dodaniem tej funkcji (zero regresji).
const A321_OEW_KG         = 48500;
const A321_MAX_FUEL_KG    = 23700;
const A321_MAX_PAYLOAD_KG = 22000;
const A321_MTOW_KG        = 93500;
const A321_DEFAULT_FUEL_KG    = 14500;
const A321_DEFAULT_PAYLOAD_KG = 12000; // 48500 + 14500 + 12000 = 75000 kg

// Ramiona przesuniĂ„â„˘cia CG (metry, oÄąâ€ş Z lokalna Ă˘â‚¬â€ť dziÄ‚Ĺ‚b dodatni) WZGLĂ„ÂDEM
// domyÄąâ€şlnego zaÄąâ€šadowania powyÄąÄ˝ej, per kg odchylenia od wartoÄąâ€şci domyÄąâ€şlnej.
// Paliwo siedzi w skrzydÄąâ€šach Ă˘â‚¬â€ť bardzo blisko CG z zaÄąâ€šoÄąÄ˝enia konstrukcyjnego
// (samoloty tak siĂ„â„˘ projektuje, ÄąÄ˝eby zuÄąÄ˝ycie paliwa w locie nie psuÄąâ€šo
// wywaÄąÄ˝enia) Ă˘â‚¬â€ť stĂ„â€¦d malutkie ramiĂ„â„˘. Payload (kabina + Äąâ€šadownie) rozkÄąâ€šada siĂ„â„˘
// gÄąâ€šÄ‚Ĺ‚wnie ZA skrzydÄąâ€šem (dÄąâ€šugi tylny kadÄąâ€šub, tylna Äąâ€šadownia) Ă˘â‚¬â€ť jego ramiĂ„â„˘ jest
// wyraÄąĹźnie ujemne: wiĂ„â„˘cej payloadu ciĂ„â€¦gnie CG do tyÄąâ€šu, mniej payloadu (bliÄąÄ˝ej
// samego OEW) Ă˘â‚¬â€ť CG do przodu. To zgodne z realnĂ„â€¦ praktykĂ„â€¦ linii lotniczych
// (doÄąâ€šadowanie tylnej Äąâ€šadowni bywa Äąâ€şwiadomie uÄąÄ˝ywane do przesuniĂ„â„˘cia CG do
// tyÄąâ€šu i zmniejszenia oporu wywoÄąâ€šanego wywaÄąÄ˝eniem).
const A321_FUEL_ARM_Z    = 0.3;
const A321_PAYLOAD_ARM_Z = -3.5;

// Stan czytany/zapisywany przez UI (sim-weight-ui.js). `pending*` to to, co
// aktualnie pokazujĂ„â€¦ suwaki Ă˘â‚¬â€ť NIE wpÄąâ€šywa na fizykĂ„â„˘, dopÄ‚Ĺ‚ki nie wywoÄąâ€ša siĂ„â„˘
// applyAircraftWeight() (co dzieje siĂ„â„˘ WYÄąÂĂ„â€žCZNIE z A321Entity.reset(), zgodnie
// z decyzjĂ„â€¦: tankowanie/zaÄąâ€šadunek liczy siĂ„â„˘ przed startem, nie w locie).
// `applied*` to to, co faktycznie dziaÄąâ€ša w fizyce od ostatniego reset() Ă˘â‚¬â€ť UI
// pokazuje oba, ÄąÄ˝eby byÄąâ€šo widaĂ„â€ˇ czy suwak "czeka" na Reset.
const AircraftWeight = {
  pendingFuelKg:    A321_DEFAULT_FUEL_KG,
  pendingPayloadKg: A321_DEFAULT_PAYLOAD_KG,
  appliedFuelKg:    A321_DEFAULT_FUEL_KG,
  appliedPayloadKg: A321_DEFAULT_PAYLOAD_KG,
  appliedTotalMassKg: A321_OEW_KG + A321_DEFAULT_FUEL_KG + A321_DEFAULT_PAYLOAD_KG,
  appliedCgShiftM:    0,
  mtowExceededByKg:   0, // >0 gdy WYBRANA kombinacja przekraczaÄąâ€ša MTOW (masa i tak ograniczona do MTOW Ă˘â‚¬â€ť patrz niÄąÄ˝ej)
};

// Przelicza bezwÄąâ€šadnoÄąâ€şĂ„â€ˇ (patrz A321_IYY/IXX/IZZ) z aktualnej A321_PARAMS.mass.
// Sam kadÄąâ€šub/rozpiĂ„â„˘toÄąâ€şĂ„â€ˇ siĂ„â„˘ nie zmieniajĂ„â€¦ (promieÄąâ€ž ÄąÄ˝yracji zaleÄąÄ˝y od
// geometrii, nie od zaÄąâ€šadowania) Ă˘â‚¬â€ť zmienia siĂ„â„˘ tylko masa we wzorze.
function recomputeInertia() {
  A321_IYY = A321_PARAMS.mass * (0.25 * A321_FUSELAGE_LEN) ** 2;
  A321_IXX = A321_PARAMS.mass * (0.23 * A321_PARAMS.span) ** 2;
  A321_IZZ = A321_PARAMS.mass * (0.27 * A321_FUSELAGE_LEN) ** 2;
}

// Przelicza sztywnoÄąâ€şĂ„â€ˇ/tÄąâ€šumienie zawieszenia (patrz GEAR_K/C_NOSE/MAIN) z
// aktualnej A321_PARAMS.mass Ă˘â‚¬â€ť czĂ„â„˘stoÄąâ€şĂ„â€ˇ wÄąâ€šasna (OMEGA) i tÄąâ€šumienie (ZETA)
// zostajĂ„â€¦ te same (to wÄąâ€šasnoÄąâ€şci amortyzatora, nie Äąâ€šadunku), zmienia siĂ„â„˘ tylko
// obciĂ„â€¦ÄąÄ˝enie statyczne, ktÄ‚Ĺ‚re skaluje sztywnoÄąâ€şĂ„â€ˇ/tÄąâ€šumienie w tych wzorach.
function recomputeGearStiffness() {
  GEAR_K_NOSE = A321_PARAMS.mass * GEAR_LOAD_SHARE_NOSE * GEAR_SUSP_OMEGA_NOSE ** 2;
  GEAR_C_NOSE = 2 * GEAR_SUSP_ZETA_NOSE * GEAR_SUSP_OMEGA_NOSE * A321_PARAMS.mass * GEAR_LOAD_SHARE_NOSE;
  GEAR_K_MAIN = A321_PARAMS.mass * GEAR_LOAD_SHARE_MAIN * GEAR_SUSP_OMEGA_MAIN ** 2;
  GEAR_C_MAIN = 2 * GEAR_SUSP_ZETA_MAIN * GEAR_SUSP_OMEGA_MAIN * A321_PARAMS.mass * GEAR_LOAD_SHARE_MAIN;
}

// Czyste przeliczenie (BEZ efektÄ‚Ĺ‚w ubocznych Ă˘â‚¬â€ť nie rusza A321_PARAMS.mass ani
// ÄąÄ˝adnej staÄąâ€šej fizyki) Ă˘â‚¬â€ť uÄąÄ˝ywane w dwÄ‚Ĺ‚ch miejscach:
//  1) UI (sim-weight-ui.js) do podglĂ„â€¦du na ÄąÄ˝ywo podczas przesuwania suwaka,
//     ZANIM cokolwiek zostanie zastosowane do fizyki;
//  2) applyAircraftWeight() niÄąÄ˝ej, jako pierwszy krok przed efektami ubocznymi.
// DziĂ„â„˘ki temu logika limitu MTOW/CG istnieje w jednym miejscu, a suwak moÄąÄ˝e
// pokazywaĂ„â€ˇ "co by byÄąâ€šo gdyby" bez ryzyka przypadkowego dotkniĂ„â„˘cia fizyki
// w locie.
function computeAircraftWeight(fuelKg, payloadKg) {
  const fuel    = Math.max(0, Math.min(A321_MAX_FUEL_KG, fuelKg));
  const payload = Math.max(0, Math.min(A321_MAX_PAYLOAD_KG, payloadKg));
  const rawTotal = A321_OEW_KG + fuel + payload;

  // Limit MTOW + ostrzeÄąÄ˝enie (decyzja): sam limit to twarde ograniczenie masy
  // uÄąÄ˝ytej w fizyce; ostrzeÄąÄ˝enie (exceededBy > 0) UI pokazuje osobno.
  const exceededBy = Math.max(0, rawTotal - A321_MTOW_KG);
  const total = exceededBy > 0 ? A321_MTOW_KG : rawTotal;

  // PrzesuniĂ„â„˘cie CG liczone WZGLĂ„ÂDEM domyÄąâ€şlnego zaÄąâ€šadowania (patrz komentarz
  // przy A321_FUEL_ARM_Z) Ă˘â‚¬â€ť przy fuel=domyÄąâ€şlne i payload=domyÄąâ€şlne zawsze da
  // dokÄąâ€šadnie 0, niezaleÄąÄ˝nie od tego czy total zostaÄąâ€š przyciĂ„â„˘ty do MTOW.
  const dFuel    = fuel    - A321_DEFAULT_FUEL_KG;
  const dPayload = payload - A321_DEFAULT_PAYLOAD_KG;
  const cgShiftZ = (dFuel * A321_FUEL_ARM_Z + dPayload * A321_PAYLOAD_ARM_Z) / total;

  return { fuel, payload, total, cgShiftZ, exceededBy };
}

// Punkt wejÄąâ€şcia wywoÄąâ€šywany WYÄąÂĂ„â€žCZNIE z A321Entity.reset() (patrz tam) Ă˘â‚¬â€ť bierze
// pendingFuelKg/pendingPayloadKg (ustawione przez suwaki UI) i faktycznie
// przelicza masĂ„â„˘, bezwÄąâ€šadnoÄąâ€şĂ„â€ˇ, zawieszenie i przesuniĂ„â„˘cie CG. Bez zmiany
// wartoÄąâ€şci domyÄąâ€şlnych ta funkcja zawsze da dokÄąâ€šadnie taki sam wynik jak przed
// jej dodaniem (mass=75000, cgShiftZ=0) Ă˘â‚¬â€ť zero regresji dla obecnego czucia
// lotu.
function applyAircraftWeight(fuelKg, payloadKg) {
  const { fuel, payload, total, cgShiftZ, exceededBy } = computeAircraftWeight(fuelKg, payloadKg);

  A321_PARAMS.mass = total;
  recomputeInertia();
  recomputeGearStiffness();

  WING_AC.z   = WING_AC_BASE_Z   - cgShiftZ;
  TAIL_AC.z   = TAIL_AC_BASE_Z   - cgShiftZ;
  FIN_AC.z    = FIN_AC_BASE_Z    - cgShiftZ;
  THRUST_PT.z = THRUST_PT_BASE_Z - cgShiftZ;

  AircraftWeight.appliedFuelKg      = fuel;
  AircraftWeight.appliedPayloadKg   = payload;
  AircraftWeight.appliedTotalMassKg = total;
  AircraftWeight.appliedCgShiftM    = cgShiftZ;
  AircraftWeight.mtowExceededByKg   = exceededBy;

  return { total, cgShiftZ, exceededBy };
}
const GEAR_HARDSTOP_K_MULT = 12; // dodatkowa sztywnoÄąâ€şĂ„â€ˇ po przekroczeniu GEAR_SUSPENSION_TRAVEL (twardy zderzak Ă˘â‚¬â€ť nie odbicie, tylko szybkie "zatrzymanie")

// Model opony: tarcie toczenia/hamowania wzdÄąâ€šuÄąÄ˝ kierunku jazdy + przyczepnoÄąâ€şĂ„â€ˇ
// boczna (grip). "SztywnoÄąâ€şĂ„â€ˇ" (TIRE_*_STIFF) to liniowy model opony (siÄąâ€ša ~
// prĂ„â„˘dkoÄąâ€şĂ„â€ˇ poÄąâ€şlizgu), odciĂ„â„˘ty na granicy tarcia Coulomba (muĂ‚Â·N) Ă˘â‚¬â€ť standardowe,
// stabilne numerycznie podejÄąâ€şcie z dynamiki pojazdÄ‚Ĺ‚w.
const TIRE_ROLLING_MU  = 0.02;
const TIRE_BRAKE_MU    = 0.45;

// Autobrake: LOW/MED/MAX jako staÄąâ€ša frakcja TIRE_BRAKE_MU (nie regulator
// staÄąâ€šego opÄ‚Ĺ‚ÄąĹźnienia Ă˘â‚¬â€ť patrz uzasadnienie przy autobrakeActive w
// physicsUpdate: siÄąâ€ša tarcia skaluje siĂ„â„˘ z chwilowym obciĂ„â€¦ÄąÄ˝eniem koÄąâ€ša, wiĂ„â„˘c
// efektywne opÄ‚Ĺ‚ÄąĹźnienie i tak wychodzi w przybliÄąÄ˝eniu staÄąâ€še niezaleÄąÄ˝nie od
// masy samolotu, bez potrzeby osobnej pĂ„â„˘tli regulacyjnej).
const AUTOBRAKE_MU_FRAC     = { LOW: 0.30, MED: 0.60, MAX: 1.0 };
const AUTOBRAKE_MIN_SPEED_KT = 10; // poniÄąÄ˝ej tej prĂ„â„˘dkoÄąâ€şci autobrake siĂ„â„˘ rozÄąâ€šĂ„â€¦cza (blisko prĂ„â„˘dkoÄąâ€şci koÄąâ€šowania, jak w realu)
const TIRE_LAT_GRIP_MU = 0.8;
const TIRE_LONG_STIFF  = 2.2e5; // N/(m/s) przed odciĂ„â„˘ciem przez limit Coulomba
const TIRE_LAT_STIFF   = 3.5e5; // N/(m/s)

// Pomocnicze wzory na moment obrotowy z siÄąâ€šy F={x,y,z} (skÄąâ€šadowe W LOKALNYM
// ukÄąâ€šadzie samolotu Ă˘â‚¬â€ť patrz toLocal() w physicsUpdate) przyÄąâ€šoÄąÄ˝onej w punkcie
// r={x,y,z} (lokalny offset od CG, np. TAIL_AC albo GEAR_LEFT). Wyprowadzone
// wprost z geometrii tego kodu (lokalne osie X=prawo/wingRight, Y=gÄ‚Ĺ‚ra/acUp,
// Z=przÄ‚Ĺ‚d/noseDir) tak, by zgadzaÄąâ€šy siĂ„â„˘ ze znakiem pitchRad/rollRad/yawRad juÄąÄ˝
// uÄąÄ˝ywanym w reszcie pliku (np. dodatnie pitchRad = nos w gÄ‚Ĺ‚rĂ„â„˘, jak w
// noseDir.y = sin(pitchRad) niÄąÄ˝ej) Ă˘â‚¬â€ť nie sĂ„â€¦ to wzory z podrĂ„â„˘cznika wklejone
// bez sprawdzenia znaku.
function _pitchTorque(r, F) { return r.z * F.y - r.y * F.z; }
// NAPRAWA (zgÄąâ€šoszone: "przechyla siĂ„â„˘ w lewo, ale skrĂ„â„˘ca w prawo"): pierwotna
// wersja tej funkcji (r.y*F.x - r.x*F.y) byÄąâ€ša wyprowadzona pod BÄąÂĂ„ÂDNY znak
// rollQ (patrz wyÄąÄ˝ej) Ă˘â‚¬â€ť skÄąâ€šadowa Y wingRight/acUp byÄąâ€ša wtedy DOKÄąÂADNIE
// PRZECIWNA do tego, co faktycznie pokazuje mesh.rotation.set(...,'YXZ') na
// ekranie (zweryfikowane numerycznie w Node z bibliotekĂ„â€¦ three.js). Skutek:
// bank w lewĂ„â€¦ byÄąâ€š poprawny WIZUALNIE (mesh nie zaleÄąÄ˝y od tej funkcji), ale
// siÄąâ€ša noÄąâ€şna/reakcje podwozia liczyÄąâ€šy skrĂ„â„˘t tak, jakby to byÄąâ€š bank w prawĂ„â€¦.
// Ta wersja (r.x*F.y - r.y*F.x, standardowa formuÄąâ€ša bez odwrÄ‚Ĺ‚cenia znaku) jest
// spÄ‚Ĺ‚jna z poprawionym rollQ i zweryfikowana na 3 niezaleÄąÄ˝nych przypadkach
// (podwozie lewe/prawe, statecznik pionowy).
function _rollTorque(r, F)  { return r.x * F.y - r.y * F.x; }
function _yawTorque(r, F)   { return r.z * F.x - r.x * F.z; }

// NAPRAWA (realizm): siÄąâ€ša noÄąâ€şna byÄąâ€ša liczona wzdÄąâ€šuÄąÄ˝ osi "gÄ‚Ĺ‚rnej" SAMOLOTU
// (acUp, obrÄ‚Ĺ‚conej razem z pitchiem), a nie wzdÄąâ€šuÄąÄ˝ osi prostopadÄąâ€šej do
// PRĂ„ÂDKOÄąĹˇCI (tzw. wind axis) Ă˘â‚¬â€ť to standardowa, podrĂ„â„˘cznikowa konwencja:
// siÄąâ€ša noÄąâ€şna Ă˘Ĺ Ä„ wzglĂ„â„˘dny wiatr, opÄ‚Ĺ‚r Ă˘ÂÄ„ wzglĂ„â„˘dny wiatr (opÄ‚Ĺ‚r juÄąÄ˝ tak liczono:
// dragVec = -vel.normalize()*dragMag, patrz physicsUpdate). Przy fpa=0 (lot
// poziomy) i niezerowym kĂ„â€¦cie natarcia (alpha=pitchRad) dawaÄąâ€šo to siÄąâ€šĂ„â„˘
// noÄąâ€şnĂ„â€¦ SZTUCZNIE przechylonĂ„â€¦ do tyÄąâ€šu o kĂ„â€¦t alpha, co wymagaÄąâ€šo duÄąÄ˝o wiĂ„â„˘cej
// ciĂ„â€¦gu niÄąÄ˝ w rzeczywistoÄąâ€şci (zweryfikowane: przy alpha=8.3Ă‚Â° prawdziwa
// rÄ‚Ĺ‚wnowaga siÄąâ€š wymagaÄąâ€ša throttle=0.63 zamiast fizycznie sensownego ~0.27)
// i dawaÄąâ€šo faÄąâ€šszywĂ„â€¦, dodatkowĂ„â€¦ siÄąâ€šĂ„â„˘ poziomĂ„â€¦ podczas duÄąÄ˝ych wychyleÄąâ€ž alpha
// (np. w trakcie phugoidu czy przeciĂ„â€¦gniĂ„â„˘cia Ă˘â‚¬â€ť czĂ„â„˘Äąâ€şĂ„â€ˇ przyczyny zgÄąâ€šoszonej
// niestabilnoÄąâ€şci pitch, patrz NAPRAWA przy flapCl[1] wyÄąÄ˝ej). Poprawka:
// liczymy kierunek "gÄ‚Ĺ‚rny" wzglĂ„â„˘dem PRĂ„ÂDKOÄąĹˇCI (windUp), nie wzglĂ„â„˘dem
// pitchu Ă˘â‚¬â€ť pokrywajĂ„â€¦ siĂ„â„˘ dokÄąâ€šadnie wtedy, gdy alpha=0, tak jak powinno byĂ„â€ˇ.
// Zweryfikowane symulacyjnie (Node+three.js): trym po poprawce daje
// throttleĂ˘â€°Â0.265/0.323 (flaps=0/1) Ă˘â‚¬â€ť niemal identyczne z niezaleÄąÄ˝nie
// policzonym podrĂ„â„˘cznikowym L=ciĂ„â„˘ÄąÄ˝ar/T=opÄ‚Ĺ‚r, co potwierdza poprawnoÄąâ€şĂ„â€ˇ.
// Dotyczy TYLKO skrzydÄąâ€ša i usterzenia poziomego (liftVec/tailForceVec) Ă˘â‚¬â€ť
// statecznik pionowy/ster kierunku i lotki NIE zmienione (osobny, jeszcze
// niezweryfikowany temat dla osi yaw/roll Ă˘â‚¬â€ť patrz notatka).
function _computeWindUp(vel, wingRight, acUp, airspeed) {
  if (airspeed < 3) return acUp; // za wolno, ÄąÄ˝eby kierunek prĂ„â„˘dkoÄąâ€şci byÄąâ€š miarodajny Ă˘â‚¬â€ť fallback do dawnej osi
  const velDir = vel.clone().divideScalar(airspeed);
  const w = new THREE.Vector3().crossVectors(velDir, wingRight);
  const len = w.length();
  if (len < 0.05) return acUp; // niemal rÄ‚Ĺ‚wnolegÄąâ€še do wingRight (skrajny poÄąâ€şlizg/lot bokiem) Ă˘â‚¬â€ť degeneracja, fallback
  return w.divideScalar(len);
}

// ÄąĹˇrodek miĂ„â„˘dzy koÄąâ€šami gÄąâ€šÄ‚Ĺ‚wnymi (lewym i prawym) Ă˘â‚¬â€ť najniÄąÄ˝szy, najbardziej
// reprezentatywny pojedynczy punkt do TANIEGO sprawdzania odlegÄąâ€šoÄąâ€şci od ziemi,
// gdy samolot jest wysoko (patrz GEAR_FAR_CHECK_* niÄąÄ˝ej).
const GEAR_MAIN_MID = { x: (GEAR_LEFT.x + GEAR_RIGHT.x) / 2, y: GEAR_LEFT.y, z: GEAR_LEFT.z };

// Z dala od ziemi nie ma sensu liczyĂ„â€ˇ dokÄąâ€šadnie WSZYSTKICH 3 punktÄ‚Ĺ‚w podwozia
// co klatkĂ„â„˘ Ă˘â‚¬â€ť zamiast tego co klatkĂ„â„˘ sprawdzamy TYLKO wysokoÄąâ€şĂ„â€ˇ GEAR_MAIN_MID
// nad terenem (jeden tani odczyt zamiast trzech). To wciĂ„â€¦ÄąÄ˝ dzieje siĂ„â„˘ co
// klatkĂ„â„˘ (60x/s), a nie rzadziej Ă˘â‚¬â€ť przy sprawdzaniu np. co 0.2 s samolot przy
// duÄąÄ˝ej prĂ„â„˘dkoÄąâ€şci mÄ‚Ĺ‚gÄąâ€šby "wjechaĂ„â€ˇ" w strome zbocze/gÄ‚Ĺ‚rĂ„â„˘ miĂ„â„˘dzy dwoma
// sprawdzeniami, zanim zdĂ„â€¦ÄąÄ˝y przeÄąâ€šĂ„â€¦czyĂ„â€ˇ siĂ„â„˘ na tryb dokÄąâ€šadny. Gdy wysokoÄąâ€şĂ„â€ˇ
// spadnie poniÄąÄ˝ej GEAR_FAR_CHECK_ENTER_AGL, przechodzimy w tryb dokÄąâ€šadny (3
// punkty, co klatkĂ„â„˘) i zostajemy w nim, dopÄ‚Ĺ‚ki nie oddalimy siĂ„â„˘ z zapasem
// powyÄąÄ˝ej GEAR_FAR_CHECK_EXIT_AGL (histereza, ÄąÄ˝eby nie przeÄąâ€šĂ„â€¦czaĂ„â€ˇ siĂ„â„˘ w kÄ‚Ĺ‚Äąâ€ško).
const GEAR_FAR_CHECK_ENTER_AGL = 120; // m Ă˘â‚¬â€ť poniÄąÄ˝ej tej wysokoÄąâ€şci wÄąâ€šĂ„â€¦cz dokÄąâ€šadne sprawdzanie 3 punktÄ‚Ĺ‚w
const GEAR_FAR_CHECK_EXIT_AGL  = 150; // m Ă˘â‚¬â€ť powyÄąÄ˝ej tej wysokoÄąâ€şci wrÄ‚Ĺ‚Ă„â€ˇ do taniego sprawdzania 1 punktem (zapas histerezy jak wczeÄąâ€şniej)

// JeÄąâ€şli ktÄ‚Ĺ‚rekolwiek koÄąâ€šo jest zanurzone w terenie gÄąâ€šĂ„â„˘biej niÄąÄ˝ to (kilka metrÄ‚Ĺ‚w,
// znacznie wiĂ„â„˘cej niÄąÄ˝ normalne ugiĂ„â„˘cie zawieszenia GEAR_SUSPENSION_TRAVEL) Ă˘â‚¬â€ť
// to nie jest zwykÄąâ€še lĂ„â€¦dowanie, tylko prawdziwa sytuacja awaryjna (np. stromy
// lot nurkowy, teleportacja, spawn w zÄąâ€šym miejscu) Ă˘â‚¬â€ť samolot szybko (ale
// pÄąâ€šynnie, nie w jednej klatce) wraca na powierzchniĂ„â„˘ Ă˘â‚¬â€ť patrz GEAR_EMERGENCY_SETTLE_TAU.
const GEAR_EMERGENCY_PEN_M = 10; // m
const GEAR_EMERGENCY_SETTLE_TAU = 0.05; // s Ă˘â‚¬â€ť znacznie szybsze niÄąÄ˝ normalne osiadanie, ale nie natychmiastowe (Äąâ€šagodniejszy "wypchnij na powierzchniĂ„â„˘")

// DEBUG: pomaga namierzyĂ„â€ˇ przypadki zapadania siĂ„â„˘ samolotu pod ziemiĂ„â„˘ (patrz
// sampleGearPoint/_debugZoomWarn i settleOnGear). WyÄąâ€šĂ„â€¦cz w konsoli przeglĂ„â€¦darki
// wpisujĂ„â€¦c: DEBUG_GEAR = false
window.DEBUG_GEAR = window.DEBUG_GEAR ?? true;
// DEBUG: prosty log stanu pitch/input co DEBUG_HEARTBEAT_SEC sekund, w zwiĂ„â„˘zÄąâ€šym
// formacie klucz=wartoÄąâ€şĂ„â€ˇ (do wklejenia wprost przy debugowaniu ustawieÄąâ€ž pitch/
// attitude-hold). WyÄąâ€šĂ„â€¦cz w konsoli przeglĂ„â€¦darki wpisujĂ„â€¦c: DEBUG_PITCH = false
window.DEBUG_PITCH = window.DEBUG_PITCH ?? true;
const DEBUG_HEARTBEAT_SEC = 1.0; // co ile sekund wypisywaĂ„â€ˇ bieÄąÄ˝Ă„â€¦cy stan (patrz koniec physicsUpdate)

// Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬ Kulki-znaczniki 3 punktÄ‚Ĺ‚w kolizji podwozia Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬
//
// MaÄąâ€še kolorowe kule pokazujĂ„â€¦ce dokÄąâ€šadnie te same 3 punkty, ktÄ‚Ĺ‚re silnik fizyki
// uÄąÄ˝ywa do wykrywania kontaktu z ziemiĂ„â€¦ (GEAR_NOSE/GEAR_LEFT/GEAR_RIGHT) Ă˘â‚¬â€ť Äąâ€şwiecĂ„â€¦
// peÄąâ€šnym kolorem gdy dane koÄąâ€šo dotyka/koliduje z terenem, sĂ„â€¦ przygaszone gdy nie.
// Czysto wizualny debug/feedback, nie wpÄąâ€šywa na fizykĂ„â„˘.
const GEAR_MARKER_RADIUS = 0.35; // m
const GEAR_MARKER_COLORS = {
  nose:  0xffdd33, // ÄąÄ˝Ä‚Ĺ‚Äąâ€šty  Ă˘â‚¬â€ť przednie koÄąâ€šo
  left:  0x33ccff, // niebieski Ă˘â‚¬â€ť lewe gÄąâ€šÄ‚Ĺ‚wne koÄąâ€šo
  right: 0xff3355, // czerwony Ă˘â‚¬â€ť prawe gÄąâ€šÄ‚Ĺ‚wne koÄąâ€šo
};

//    wzdÄąâ€šuÄąÄ˝ kierunku SÄąâ€šoÄąâ€žca) Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬
//
// W przeciwieÄąâ€žstwie do poprzedniej wersji (rĂ„â„˘cznie narysowany, przybliÄąÄ˝ony
// obrys), obrys cienia jest teraz wyliczony z PRAWDZIWYCH wierzchoÄąâ€škÄ‚Ĺ‚w
// wczytanego a321.obj: po wczytaniu modelu bierzemy WSZYSTKIE wierzchoÄąâ€ški
// wszystkich czĂ„â„˘Äąâ€şci (kadÄąâ€šub, skrzydÄąâ€ša, statecznik Ă˘â‚¬â€ť z wyÄąâ€šĂ„â€¦czeniem elementÄ‚Ĺ‚w
// wewnĂ„â„˘trznych typu cockpit_inside/interface, ktÄ‚Ĺ‚re i tak sĂ„â€¦ w caÄąâ€šoÄąâ€şci
// wewnĂ„â€¦trz bryÄąâ€šy kadÄąâ€šuba i nie mogĂ„â€¦ poszerzyĂ„â€ˇ sylwetki), rzutujemy je na
// pÄąâ€šaszczyznĂ„â„˘ X-Z (widok z gÄ‚Ĺ‚ry, w LOKALNYM ukÄąâ€šadzie samolotu Ă˘â‚¬â€ť ten sam co
// GEAR_NOSE/LEFT/RIGHT) i liczymy 2D convex hull (otoczkĂ„â„˘ wypukÄąâ€šĂ„â€¦) tego rzutu.
// To daje dokÄąâ€šadny, prawdziwy kontur sylwetki samolotu z gÄ‚Ĺ‚ry Ă˘â‚¬â€ť bez
// zgadywania wymiarÄ‚Ĺ‚w, i bez ryzyka samoprzecinajĂ„â€¦cych siĂ„â„˘ trÄ‚Ĺ‚jkĂ„â€¦tÄ‚Ĺ‚w (hull
// jest z definicji wypukÄąâ€šy, wiĂ„â„˘c triangulacja "fan" od centroidu zawsze
// wychodzi poprawnie, inaczej niÄąÄ˝ przy rĂ„â„˘cznie rysowanym, nie do koÄąâ€žca
// wypukÄąâ€šym obrysie).
//
// Liczenie hull z ~35 tys. wierzchoÄąâ€škÄ‚Ĺ‚w trwa rzĂ„â„˘du kilkudziesiĂ„â„˘ciu
// milisekund Ă˘â‚¬â€ť WYKONYWANE WYÄąÂĂ„â€žCZNIE RAZ, zaraz po wczytaniu modelu (patrz
// juÄąÄ˝ tylko tego gotowego, maÄąâ€šego zestawu punktÄ‚Ĺ‚w obrysu (typowo kilkanaÄąâ€şcie-
// kilkadziesiĂ„â€¦t), dokÄąâ€šadnie tak jak poprzednio dla rĂ„â„˘cznego obrysu.

// Nazwy czĂ„â„˘Äąâ€şci modelu POMIJANE przy liczeniu obrysu Ă˘â‚¬â€ť elementy wnĂ„â„˘trza
// kokpitu leÄąÄ˝Ă„â€¦ caÄąâ€škowicie wewnĂ„â€¦trz bryÄąâ€šy zewnĂ„â„˘trznej kadÄąâ€šuba i tylko
// spowalniaÄąâ€šyby liczenie hull bez ÄąÄ˝adnego wpÄąâ€šywu na wynik.
const SHADOW_HULL_EXCLUDE_PREFIXES = ['cockpit_inside', 'cockpit_interface'];

// Andrew's monotone chain Ă˘â‚¬â€ť 2D convex hull, O(n log n), zwraca punkty w
// kolejnoÄąâ€şci przeciwnej do ruchu wskazÄ‚Ĺ‚wek zegara (CCW), bez duplikatu
// punktu poczĂ„â€¦tkowego na koÄąâ€žcu.
function _convexHull2D(points) {
  const pts = points.slice().sort((a, b) => a.x - b.x || a.z - b.z);
  const n = pts.length;
  if (n < 3) return pts;
  const cross = (o, a, b) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = n - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}


function groundEffectFactor(agl_m, span) {
  const h_b = Math.max(0, agl_m) / (span * 0.5);
  if (h_b >= 1.0) return 1.0;
  return 1.0 - 0.48 * Math.exp(-4.0 * h_b);
}

function groundSteerTrackFactor(speedKt) {
  if (speedKt <= 50) return 1.0;
  if (speedKt >= 115) return 0.0;
  return 1.0 - (speedKt - 50) / 65;
}

// (Dawny elevatorAuthority()/ELEVATOR_MIN_KT/FULL_KT Ă˘â‚¬â€ť sztuczna krzywa "siÄąâ€šy
// autorytetu steru" zaleÄąÄ˝na od prĂ„â„˘dkoÄąâ€şci Ă˘â‚¬â€ť zostaÄąâ€š USUNIĂ„ÂTY. W nowym modelu to
// samo zjawisko (ster wysokoÄąâ€şci nic nie daje przy maÄąâ€šej prĂ„â„˘dkoÄąâ€şci, coraz
// wiĂ„â„˘cej przy wiĂ„â„˘kszej) wynika WPROST z fizyki: siÄąâ€ša aerodynamiczna na
// usterzeniu ~ q = Ă‚ËťÄŽÂVĂ‚Ë›, wiĂ„â„˘c naturalnie roÄąâ€şnie z KWADRATEM prĂ„â„˘dkoÄąâ€şci bez
// ÄąÄ˝adnej dodatkowej, rĂ„â„˘cznie dopasowanej krzywej Ă˘â‚¬â€ť patrz ELEVATOR_CL_PER_RAD i
// TAIL_AC w physicsUpdate.)

// Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬ Odbicie sprĂ„â„˘ÄąÄ˝yste przy mocnym/nietypowym uderzeniu w teren Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬
//
// Normalne, Äąâ€šagodne osiadanie na 3 punktach podwozia (patrz settleOnGear) zostaje
// bez zmian Ă˘â‚¬â€ť to obsÄąâ€šuguje zwykÄąâ€še lĂ„â€¦dowania i koÄąâ€šowanie. Ale gdy samolot uderzy
// w teren z duÄąÄ˝Ă„â€¦ prĂ„â„˘dkoÄąâ€şciĂ„â€¦ PIONOWĂ„â€ž (twarde lĂ„â€¦dowanie / "zaorywanie" ziemi) albo
// wjedzie w stromĂ„â€¦ Äąâ€şcianĂ„â„˘ terenu przy duÄąÄ˝ej prĂ„â„˘dkoÄąâ€şci POZIOMEJ (np. w zbocze
// gÄ‚Ĺ‚ry), to nie jest juÄąÄ˝ "osiadanie zawieszenia" Ă˘â‚¬â€ť to zderzenie, ktÄ‚Ĺ‚re powinno
// fizycznie odrzuciĂ„â€ˇ samolot: odbicie wektora prĂ„â„˘dkoÄąâ€şci wzglĂ„â„˘dem normalnej
// terenu w miejscu uderzenia, z tÄąâ€šumieniem (coefficient of restitution) Ă˘â‚¬â€ť czĂ„â„˘Äąâ€şĂ„â€ˇ
// energii uderzenia jest tracona (deformacja/haÄąâ€šas/ciepÄąâ€šo), reszta wraca jako
// odbicie, dokÄąâ€šadnie jak przy zderzeniu sprĂ„â„˘ÄąÄ˝ystym z tÄąâ€šumieniem.
const BOUNCE_TRIGGER_VSPEED   = 7.2;  // m/s prĂ„â„˘dkoÄąâ€şci pionowej w dÄ‚Ĺ‚Äąâ€š Ă˘â‚¬â€ť od tego uznajemy uderzenie za "twarde" (nie zwykÄąâ€še osiadanie)
const BOUNCE_TRIGGER_HSPEED_INTO_SLOPE = 8.5; // m/s skÄąâ€šadowej prĂ„â„˘dkoÄąâ€şci WCHODZĂ„â€žCEJ w stromy teren (wzdÄąâ€šuÄąÄ˝ normalnej), przy locie w zbocze
// NAPRAWA: `velIntoSlope` roÄąâ€şnie z CAÄąÂKOWITĂ„â€¦ prĂ„â„˘dkoÄąâ€şciĂ„â€¦ (Ă˘â€°Â prĂ„â„˘dkoÄąâ€şĂ„â€ˇ_pozioma
// Ä‚â€” sin(nachylenie)) Ă˘â‚¬â€ť bez dolnego progu kĂ„â€¦ta, przy duÄąÄ˝ej prĂ„â„˘dkoÄąâ€şci naziemnej
// (200+ kt) zwykÄąâ€še, drobne pofaÄąâ€šdowanie pasa (4-5Ă‚Â°, normalny szum terenu)
// wystarczaÄąâ€šo, ÄąÄ˝eby przekroczyĂ„â€ˇ 8.5 m/s i wywoÄąâ€šaĂ„â€ˇ "twarde odbicie od zbocza" Ă˘â‚¬â€ť
// mechanikĂ„â„˘ pomyÄąâ€şlanĂ„â€¦ do RZECZYWISTEGO wlecenia w stok gÄ‚Ĺ‚ry, nie do kolejnych
// nierÄ‚Ĺ‚wnoÄąâ€şci pÄąâ€šyty. StĂ„â€¦d faÄąâ€šszywe mikro-odbicia wÄąâ€šaÄąâ€şnie przy duÄąÄ˝ych
// prĂ„â„˘dkoÄąâ€şciach, ktÄ‚Ĺ‚re rozbijaÄąâ€šy prÄ‚Ĺ‚by czystej rotacji na starcie.
const BOUNCE_INTO_SLOPE_MIN_DEG = 18; // Ă‚Â° Ă˘â‚¬â€ť poniÄąÄ˝ej tego kĂ„â€¦ta to zwykÄąâ€šy szum terenu, nie "zbocze", niezaleÄąÄ˝nie od prĂ„â„˘dkoÄąâ€şci (podniesione z 12Ă‚Â° Ă˘â‚¬â€ť przy duÄąÄ˝ej prĂ„â„˘dkoÄąâ€şci rozbiegu drobne pofaÄąâ€šdowanie DEM nadal dawaÄąâ€šo czasem >12Ă‚Â° i wywoÄąâ€šywaÄąâ€šo faÄąâ€šszywe odbicia)
const BOUNCE_RESTITUTION      = 0.28; // uÄąâ€šamek prĂ„â„˘dkoÄąâ€şci normalnej odbitej z powrotem (0=brak odbicia/pochÄąâ€šoniĂ„â„˘te, 1=idealnie sprĂ„â„˘ÄąÄ˝yste)
const BOUNCE_TANGENT_DAMPING  = 0.82; // uÄąâ€šamek prĂ„â„˘dkoÄąâ€şci stycznej zachowanej po uderzeniu (tarcie/poÄąâ€şlizg podczas odbicia)
const BOUNCE_MIN_UP_SPEED     = 1.8;  // m/s Ă˘â‚¬â€ť minimalna prĂ„â„˘dkoÄąâ€şĂ„â€ˇ "w gÄ‚Ĺ‚rĂ„â„˘" nadana przy odbiciu, ÄąÄ˝eby efekt byÄąâ€š czytelny nawet przy uderzeniu prawie stycznym
// (Dawne BOUNCE_ON_GROUND_SLOPE_DEG/MIN_SPEED i GROUND_SLOPE_ACCEL_GAIN/DAMPING
// zostaÄąâ€šy USUNIĂ„ÂTE Ă˘â‚¬â€ť to byÄąâ€šy rĂ„â„˘czne "Äąâ€šatki" udajĂ„â€¦ce efekt zjeÄąÄ˝dÄąÄ˝ania po zboczu
// i odskakiwania od jego Äąâ€şciany. W nowym modelu obie rzeczy wynikajĂ„â€¦ WPROST z
// prawdziwych siÄąâ€š: niezrÄ‚Ĺ‚wnowaÄąÄ˝ona skÄąâ€šadowa grawitacji wzdÄąâ€šuÄąÄ˝ stoku naturalnie
// przyspiesza samolot w dÄ‚Ĺ‚Äąâ€š zbocza, a reakcja normalna terenu pod kĂ„â€¦tem robi
// swoje bez potrzeby osobnej "kary" za stromiznĂ„â„˘.)

const planeInput = {
  pitch: 0, roll: 0, yaw: 0,
  throttleUp: false, throttleDown: false,
  brakes: false,
};



// Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬ Encja samolotu A321 Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬

class A321Entity extends Entity {
  constructor(opts = {}) {
    super(Object.assign({ type: 'aircraft' }, opts));
    this.yawRad   = opts.yawRad   ?? 0;
    this.pitchRad = opts.pitchRad ?? 0;
    this.rollRad  = 0;
    this.pitchRate = 0; this.rollRate = 0; this.yawRate = 0;
    this.vel = new THREE.Vector3(0, 0, 0);
    this.throttle = 0;
    this.reverserDeployFrac = 0; // 0=schowany, 1=w peÄąâ€šni wysuniĂ„â„˘ty (patrz reverse thrust w physicsUpdate)
    this.parkingBrake = false;
    this.autobrakeLevel = 'OFF'; // 'OFF' | 'LOW' | 'MED' | 'MAX' Ă˘â‚¬â€ť patrz AUTOBRAKE_MU_FRAC

    // Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬ Autopilot Ă˘â‚¬â€ť patrz sekcja AP w physicsUpdate(). master=wyÄąâ€šĂ„â€¦cznik
    // gÄąâ€šÄ‚Ĺ‚wny; poszczegÄ‚Ĺ‚lne osie (hdgHold/altHold/vsHold/spdHold) dziaÄąâ€šajĂ„â€¦
    // tylko gdy master=true. altHold i vsHold siĂ„â„˘ wykluczajĂ„â€¦ (wÄąâ€šĂ„â€¦czenie
    // jednego wyÄąâ€šĂ„â€¦cza drugie Ă˘â‚¬â€ť dokÄąâ€šadnie jak ALT/V-S na prawdziwym MCP).
    // target* to wartoÄąâ€şci "nakrĂ„â„˘cone" na panelu AP (sim-controls.js/HTML) Ă˘â‚¬â€ť
    // PRZETRWAJĂ„â€ž reset() (pilot nie musi ich wpisywaĂ„â€ˇ na nowo po kaÄąÄ˝dym
    // repozycjonowaniu), ale master i wszystkie *Hold zawsze wyÄąâ€šĂ„â€¦czajĂ„â€¦ siĂ„â„˘
    // przy reset (bezpieczny domyÄąâ€şlny stan po kaÄąÄ˝dym starcie/teleportacji).
    this.ap = {
      master: false,
      hdgHold: false,
      altHold: false,
      vsHold: false,
      spdHold: false,
      targetHdgDeg: 360,
      targetAltFt: 3000,
      targetVsFpm: 0,
      targetSpdKt: 250,
    };
    this._athrIntegral = 0; // integrator autothrust (patrz AP_SPD_KI) Ă˘â‚¬â€ť zerowany przy reset/rozÄąâ€šĂ„â€¦czeniu
    this.flaps = 1;
    this.gearDown = true;
    this.spoilers = false;
    this.onGround = true;
    // Tryb dokÄąâ€šadnego sprawdzania podwozia (patrz GEAR_FAR_CHECK_* i sampleGearPoint/sampleGear).
    // Start jako "blisko ziemi" Ă˘â‚¬â€ť bezpieczny domyÄąâ€şlny stan tuÄąÄ˝ po starcie/spawnie.
    this._nearGroundZone = true;
    this.airspeed = 0;
    this.groundSpeed = 0;
    this.windVec3 = new THREE.Vector3(0, 0, 0);
    this.windSpeedKt = 0;
    this.windDirDeg = 0;
    this.vs = 0;
    this._alpha = 0; this._cl = 0; this._isStalling = false;
    this._isOverspeed = false; // histereza liczona nizej (patrz przycinanie predkosci do VMO)
    this.terrainZoom = 15; // maks. dostĂ„â„˘pna dokÄąâ€šadnoÄąâ€şĂ„â€ˇ danych wysokoÄąâ€şciowych (~3 m/px) Ă˘â‚¬â€ť tyle samo, co dla renderowanego terenu (patrz sim-terrain.js: buildMeshWithNeighbors ogranicza DEM do z15)

    const grp = new THREE.Group();
    this.mesh = grp;
    this.modelLoaded = false;
    this._parts = {}; // cache animowanych czĂ„â„˘Äąâ€şci Ă˘â‚¬â€ť wypeÄąâ€šniane po wczytaniu modelu

    // Kulki-znaczniki 3 punktÄ‚Ĺ‚w kolizji podwozia (patrz GEAR_MARKER_*) Ă˘â‚¬â€ť osobne
    // meshe DODANE BEZPOÄąĹˇREDNIO DO SCENY (nie do `grp`), bo majĂ„â€¦ wÄąâ€šasnĂ„â€¦ pozycjĂ„â„˘
    // Äąâ€şwiatowĂ„â€¦ liczonĂ„â€¦ z sampleGear() (a nie transformacjĂ„â„˘ wzglĂ„â„˘dem samolotu).
    this._gearMarkers = {};
    for (const k of ['nose', 'left', 'right']) {
      const mat = new THREE.MeshBasicMaterial({ color: GEAR_MARKER_COLORS[k], transparent: true, opacity: 0.35, depthTest: false });
      const m = new THREE.Mesh(new THREE.SphereGeometry(GEAR_MARKER_RADIUS, 12, 10), mat);
      m.renderOrder = 999;
      m.visible = false;
      scene.add(m);
      this._gearMarkers[k] = m;
    }
    // CieÄąâ€ž 3D w ksztaÄąâ€šcie PRAWDZIWEJ sylwetki modelu Ă˘â‚¬â€ť nie moÄąÄ˝emy zbudowaĂ„â€ˇ go
    // TERAZ (model jeszcze siĂ„â„˘ nie wczytaÄąâ€š, a hull=obrys zaleÄąÄ˝y od jego
    // geometrii). Zbudujemy go leniwie, w .then() poniÄąÄ˝ej, zaraz po
    
    
    
    // Stan odbicia sprĂ„â„˘ÄąÄ˝ystego (patrz applyBounce()) Ă˘â‚¬â€ť licznik krÄ‚Ĺ‚tkiego "cooldownu"
    // ÄąÄ˝eby jedno mocne uderzenie nie wywoÄąâ€šywaÄąâ€šo kilku odbiĂ„â€ˇ pod rzĂ„â„˘dem w kolejnych
    // klatkach, zanim samolot zdĂ„â€¦ÄąÄ˝y siĂ„â„˘ realnie oddaliĂ„â€ˇ od terenu.
    this._bounceCooldown = 0;

    // Zapisujemy promise na encji (bez zmiany zachowania Ă˘â‚¬â€ť .then/.catch dziaÄąâ€šajĂ„â€¦
    // jak wczeÄąâ€şniej) tak, by init() w sim-main.js mÄ‚Ĺ‚gÄąâ€š na niego poczekaĂ„â€ˇ i
    // zgÄąâ€šosiĂ„â€ˇ realny postĂ„â„˘p na ekranie Äąâ€šadowania zamiast pokazywaĂ„â€ˇ go "na oko".
    this.modelReadyPromise = loadA321Model().then(model => {
      model.rotation.y = A321_MODEL_ROT_Y;
      model.scale.setScalar(A321_MODEL_SCALE);
      model.translateY(A321_MODEL_TRANSLATE_Y);
      grp.add(model);
      this.modelLoaded = true;
      this.updateGearVisibility();

      // Buduj cieÄąâ€ž z PRAWDZIWEJ geometrii modelu, TERAZ gdy model.matrix jest
      // juÄąÄ˝ ustawiona (rotation.y/scale/translateY wyÄąÄ˝ej) Ă˘â‚¬â€ť patrz
      // kilkudziesiĂ„â„˘ciu ms dla ~35 tys. wierzchoÄąâ€škÄ‚Ĺ‚w), NIE co klatkĂ„â„˘.
      
      // Shadow system removed
      this._shadowHull = null;
      this._shadow = null;
      this._shadowPos = null;

// Wyszukaj animowane czĂ„â„˘Äąâ€şci RAZ Ă˘â‚¬â€ť getObjectByName() przechodzi caÄąâ€šy graf
      // sceny, wiĂ„â„˘c robienie tego co klatkĂ„â„˘ (jak wczeÄąâ€şniej w renderUpdate) jest
      // niepotrzebnym kosztem. Wynik cache'ujemy raz, po wczytaniu modelu.
      this._parts = {
        fanR:      this.mesh.getObjectByName('engines_blade_right'),
        fanL:      this.mesh.getObjectByName('engines_blade_left'),
        gearFL:    this.mesh.getObjectByName('gears_front'),
        gearBL:    this.mesh.getObjectByName('gears_back_left'),
        gearBR:    this.mesh.getObjectByName('gears_back_right'),
        beacon:    this.mesh.getObjectByName('beacon'),
        flapR:     this.mesh.getObjectByName('flap_R'),
        flapL:     this.mesh.getObjectByName('flap_L'),
        spoilerR:  this.mesh.getObjectByName('spoiler_R'),
        spoilerL:  this.mesh.getObjectByName('spoiler_L'),
        elevatorR: this.mesh.getObjectByName('elevator_R'), // Will override below
        elevatorL: this.mesh.getObjectByName('elevator_L'),
        rudder:    this.mesh.getObjectByName('rudder'),
      };

      this.mesh.traverse(c => {
        if (c.name && c.name.includes('elevator_left')) this._parts.elevatorL = c;
        if (c.name && c.name.includes('elevator_right')) this._parts.elevatorR = c;
      });

      const centerPivot = (m) => {
        if (!m || !m.geometry) return;
        m.geometry.computeBoundingBox();
        const center = new THREE.Vector3();
        m.geometry.boundingBox.getCenter(center);
        m.geometry.translate(-center.x, -center.y, -center.z);
        // JeÄąâ€şli obiekt miaÄąâ€š juÄąÄ˝ jakĂ„â€¦Äąâ€ş pozycjĂ„â„˘ z pliku (np. nie zero), musimy dodaĂ„â€ˇ nowy Äąâ€şrodek
        m.position.add(center);
      };

      const setupControlSurfaceHinge = (m) => {
        if (!m || !m.geometry || !m.geometry.getAttribute) return;
        m.geometry.computeBoundingBox();
        const box = m.geometry.boundingBox;
        const size = new THREE.Vector3();
        box.getSize(size);
        
        let axes = [
          { name: 'x', len: size.x },
          { name: 'y', len: size.y },
          { name: 'z', len: size.z }
        ];
        axes.sort((a, b) => b.len - a.len);
        const spanAxis = axes[0].name;
        const chordAxis = axes[1].name;
        
        const posAttribute = m.geometry.getAttribute('position');
        const vCount = posAttribute.count;
        let minSpan = box.min[spanAxis], maxSpan = box.max[spanAxis];
        
        let rootPoint = new THREE.Vector3();
        let tipPoint = new THREE.Vector3();
        let rootChordMin = Infinity, tipChordMin = Infinity;
        
        const spanThreshold = (maxSpan - minSpan) * 0.15;
        const tempV = new THREE.Vector3();
        
        for (let i = 0; i < vCount; i++) {
          tempV.fromBufferAttribute(posAttribute, i);
          
          if (Math.abs(tempV[spanAxis] - minSpan) < spanThreshold) {
            if (tempV[chordAxis] < rootChordMin) {
              rootChordMin = tempV[chordAxis];
              rootPoint.copy(tempV);
            }
          }
          if (Math.abs(tempV[spanAxis] - maxSpan) < spanThreshold) {
            if (tempV[chordAxis] < tipChordMin) {
              tipChordMin = tempV[chordAxis];
              tipPoint.copy(tempV);
            }
          }
        }
        
        const pivot = rootPoint.clone();
        const hingeAxis = new THREE.Vector3().subVectors(tipPoint, rootPoint).normalize();
        
        m.geometry.translate(-pivot.x, -pivot.y, -pivot.z);
        m.position.add(pivot);
        m.userData.hingeAxis = hingeAxis;
      };

      centerPivot(this._parts.fanR);
      centerPivot(this._parts.fanL);
      centerPivot(this._parts.gearFL);
      centerPivot(this._parts.gearBL);
      centerPivot(this._parts.gearBR);
      
      setupControlSurfaceHinge(this._parts.elevatorL);
      setupControlSurfaceHinge(this._parts.elevatorR);
      // NAPRAWA (zgÄąâ€šoszone: "punkt obrotu ruddera jest za bardzo do przodu"):
      // brakowaÄąâ€šo tego wywoÄąâ€šania dla steru kierunku Ă˘â‚¬â€ť obracaÄąâ€š siĂ„â„˘ wiĂ„â„˘c wokÄ‚Ĺ‚Äąâ€š
      // surowego originu z pliku .obj zamiast prawdziwej linii zawiasu
      // wyliczonej z geometrii (tak jak elevatory powyÄąÄ˝ej).
      setupControlSurfaceHinge(this._parts.rudder);

    }).catch(err => console.error('[A321] BÄąâ€šĂ„â€¦d wczytywania modelu:', err));

    this.fanAngle = 0;
    this.gearAngle = 0;
    this.beaconTimer = 0;
    this.prevFlapPos = 0;
    this.elevPos = 0;
    this.rudderPos = 0;
    this.pitchTrim = 0; // patrz PITCH_HOLD_KP/KD
    this.pitchHoldTarget = this.pitchRad; // kat pitch aktywnie utrzymywany hands-off, patrz NAPRAWA v3
  }

  get headingDeg() {
    const yd = this.yawRad * 180 / Math.PI;
    return ((180 - yd) % 360 + 360) % 360;
  }

  groundHeight() {
    const { h, zoom } = terrainHeightWithZoom(this.lat, this.lon);
    if (zoom !== null && zoom < this.terrainZoom) this._debugZoomWarn('cg', this.lat, this.lon, zoom);
    return h;
  }

  reset(opts = {}) {
    // Zastosuj aktualne ustawienia paliwa/payloadu z suwakÄ‚Ĺ‚w UI (patrz
    // AircraftWeight/applyAircraftWeight w sekcji "Waga samolotu" wyÄąÄ˝ej w tym
    // pliku) Ă˘â‚¬â€ť zgodnie z decyzjĂ„â€¦, tankowanie/zaÄąâ€šadunek liczy siĂ„â„˘ TYLKO tutaj,
    // przy reset/starcie, nigdy na ÄąÄ˝ywo w trakcie lotu.
    applyAircraftWeight(AircraftWeight.pendingFuelKg, AircraftWeight.pendingPayloadKg);

    this.lat = opts.lat ?? SPAWN_LAT;
    this.lon = opts.lon ?? SPAWN_LON;
    const groundH = this.groundHeight();
    this.altM = opts.altM ?? (groundH + GEAR_MAIN_REST_OFFSET);
    this.yawRad = opts.yawRad ?? Units.degToRad((180 - SPAWN_HEADING_DEG + 360) % 360);
    this.pitchRad = opts.pitchRad ?? 0;
    this.rollRad = 0;
    this.pitchRate = 0; this.rollRate = 0; this.yawRate = 0;
    this.vel.set(opts.velX ?? 0, opts.velY ?? 0, opts.velZ ?? 0);
    this.throttle = opts.throttle ?? 0;
    this.reverserDeployFrac = 0; // rewerser fizycznie schowany po reset Ă˘â‚¬â€ť nie jest to "ustawienie" jak autobrake/parking brake
    this.ap.master = false; this.ap.hdgHold = false; this.ap.altHold = false;
    this.ap.vsHold = false; this.ap.spdHold = false; // target* NIE sĂ„â€¦ zerowane Ă˘â‚¬â€ť patrz komentarz przy this.ap w konstruktorze
    this._athrIntegral = 0;
    this.flaps = opts.flaps ?? 1;
    this.gearDown = opts.gearDown ?? true;
    this.spoilers = false;
    this.onGround = opts.onGround ?? true;
    this._nearGroundZone = opts.onGround ?? true;
    this.pitchTrim = 0;
    this.pitchHoldTarget = this.pitchRad; // patrz NAPRAWA v3 przy PITCH_HOLD_KP
    this.heading = this.headingDeg;
    this.pitch = this.pitchRad * 180 / Math.PI;
    this.roll = 0;
    this.updateGearVisibility();
  }

  updateGearVisibility() {
    const gearGrp = this.mesh.getObjectByName('gearGroup');
    if (gearGrp) gearGrp.visible = this.gearDown;
  }

  // DEBUG: rzuca ostrzeÄąÄ˝enie w konsoli, gdy wysokoÄąâ€şĂ„â€ˇ terenu pod danym punktem
  // NIE pochodzi z najdokÄąâ€šadniejszego dostĂ„â„˘pnego DEM (this.terrainZoom, domyÄąâ€şlnie
  // Z15) Ă˘â‚¬â€ť czyli w tym miejscu jeszcze siĂ„â„˘ nie wczytaÄąâ€š. Throttlowane per punkt,
  // ÄąÄ˝eby nie zasypaĂ„â€ˇ konsoli, gdyby to trwaÄąâ€šo dÄąâ€šuÄąÄ˝szĂ„â€¦ chwilĂ„â„˘. WyÄąâ€šĂ„â€¦czane przez
  // window.DEBUG_GEAR = false w konsoli przeglĂ„â€¦darki.
  _debugZoomWarn(label, lat, lon, zoomUsed) {
    if (!window.DEBUG_GEAR) return;
    if (!this._debugZoomLog) this._debugZoomLog = {};
    const now = performance.now();
    const last = this._debugZoomLog[label];
    if (last && last.zoom === zoomUsed && now - last.t < 2000) return;
    this._debugZoomLog[label] = { zoom: zoomUsed, t: now };
    console.warn(
      `[GEAR DEBUG] "${label}": brak DEM Z${this.terrainZoom} w (${lat.toFixed(6)}, ${lon.toFixed(6)}) ` +
      `Ă˘â‚¬â€ť uÄąÄ˝yto Z${zoomUsed} zamiast. onGround=${this.onGround} altM=${this.altM.toFixed(1)}`
    );
  }

  // PrÄ‚Ĺ‚bkuje teren pod JEDNYM punktem lokalnym samolotu (offset w metrach
  // wzglĂ„â„˘dem origin encji, w lokalnym ukÄąâ€šadzie +X prawo/+Y gÄ‚Ĺ‚ra/+Z dziÄ‚Ĺ‚b).
  // noseDir/wingRight/acUp to jednostkowe wektory lokalnych osi samolotu juÄąÄ˝
  // przeliczone na przestrzeÄąâ€ž Äąâ€şwiata Ă˘â‚¬â€ť liczone wczeÄąâ€şniej w physicsUpdate().
  // Zwraca: przesuniĂ„â„˘cie wzglĂ„â„˘dem origin encji, wysokoÄąâ€şĂ„â€ˇ n.p.m. tego punktu,
  // wysokoÄąâ€şĂ„â€ˇ terenu pod nim, penetracjĂ„â„˘ (dodatnia = punkt juÄąÄ˝ w/pod ziemiĂ„â€¦) i
  // zoomUsed (DEBUG: z jakiego zoomu DEM faktycznie pochodzi wysokoÄąâ€şĂ„â€ˇ).
  sampleGearPoint(local, noseDir, wingRight, acUp, label = '?') {
    const off = wingRight.clone().multiplyScalar(local.x)
      .addScaledVector(acUp, local.y)
      .addScaledVector(noseDir, local.z);
    const worldAlt = this.altM + off.y;
    const { lat: glat, lon: glon } = offsetGeo(this.lat, this.lon, off.x, -off.z);
    const { h: gH, zoom: zoomUsed } = terrainHeightWithZoom(glat, glon);
    if (zoomUsed !== null && zoomUsed < this.terrainZoom) this._debugZoomWarn(label, glat, glon, zoomUsed);
    return { offset: off, worldAlt, groundH: gH, pen: gH - worldAlt, zoomUsed };
  }

  // PrÄ‚Ĺ‚bkuje teren NIEZALEÄąÂ»NIE pod kaÄąÄ˝dym z 3 punktÄ‚Ĺ‚w podwozia (przednie koÄąâ€šo,
  // lewe i prawe gÄąâ€šÄ‚Ĺ‚wne) Ă˘â‚¬â€ť patrz sampleGearPoint().
  sampleGear(noseDir, wingRight, acUp) {
    return {
      nose:  this.sampleGearPoint(GEAR_NOSE,  noseDir, wingRight, acUp, 'nose'),
      left:  this.sampleGearPoint(GEAR_LEFT,  noseDir, wingRight, acUp, 'left'),
      right: this.sampleGearPoint(GEAR_RIGHT, noseDir, wingRight, acUp, 'right'),
    };
  }

  // Liczy przybliÄąÄ˝onĂ„â€¦ normalnĂ„â€¦ terenu (jednostkowy wektor w gÄ‚Ĺ‚rĂ„â„˘, prostopadÄąâ€šy do
  // zbocza) pod dowolnym punktem geo, prÄ‚Ĺ‚bkujĂ„â€¦c wysokoÄąâ€şĂ„â€ˇ w 4 sĂ„â€¦siednich punktach
  // (rÄ‚Ĺ‚ÄąÄ˝nice centralne) Ă˘â‚¬â€ť potrzebne do applyBounce(), ÄąÄ˝eby odbicie od stromego
  // zbocza szÄąâ€šo w sensownym kierunku, nie tylko pionowo w gÄ‚Ĺ‚rĂ„â„˘.
  terrainNormalAt(lat, lon, stepM = 6) {
    const n = offsetGeo(lat, lon, 0, stepM);
    const s = offsetGeo(lat, lon, 0, -stepM);
    const e = offsetGeo(lat, lon, stepM, 0);
    const w = offsetGeo(lat, lon, -stepM, 0);
    const hN = terrainHeightBest(n.lat, n.lon);
    const hS = terrainHeightBest(s.lat, s.lon);
    const hE = terrainHeightBest(e.lat, e.lon);
    const hW = terrainHeightBest(w.lat, w.lon);
    const dhdx = (hE - hW) / (2 * stepM);
    const dhdz = -(hN - hS) / (2 * stepM);
    return new THREE.Vector3(-dhdx, 1, -dhdz).normalize();
  }

  bestGearPoint(gear) {
    let bestKey = 'nose', bestPen = gear.nose.pen;
    if (gear.left.pen  > bestPen) { bestKey = 'left';  bestPen = gear.left.pen; }
    if (gear.right.pen > bestPen) { bestKey = 'right'; bestPen = gear.right.pen; }
    return { key: bestKey, point: gear[bestKey] };
  }

  // Odbicie sprĂ„â„˘ÄąÄ˝yste przy mocnym/nietypowym uderzeniu w teren (patrz BOUNCE_*).
  // WywoÄąâ€šywane raz, w chwili Äąâ€şwieÄąÄ˝ego, twardego kontaktu Ă˘â‚¬â€ť modyfikuje this.vel
  // bezpoÄąâ€şrednio (odbija skÄąâ€šadowĂ„â€¦ normalnĂ„â€¦, tÄąâ€šumi skÄąâ€šadowĂ„â€¦ stycznĂ„â€¦). Zwraca true
  // jeÄąâ€şli faktycznie doszÄąâ€šo do odbicia.
  //
  // (Dawny trzeci wyzwalacz "hardGroundDrop" Ă˘â‚¬â€ť odbicie przy zwykÄąâ€šej jeÄąĹździe po
  // ziemi w stronĂ„â„˘ stromizny Ă˘â‚¬â€ť zostaÄąâ€š USUNIĂ„ÂTY: w nowym modelu kaÄąÄ˝da z 3 goleni
  // ma WÄąÂASNĂ„â€ž, prawdziwĂ„â€¦ siÄąâ€šĂ„â„˘ sprĂ„â„˘ÄąÄ˝ysto-tÄąâ€šumiĂ„â€¦cĂ„â€¦ liczonĂ„â€¦ wzdÄąâ€šuÄąÄ˝ faktycznej
  // normalnej terenu (patrz physicsUpdate), wiĂ„â„˘c jazda po nierÄ‚Ĺ‚wnym/pochÄąâ€šym
  // terenie sama w sobie juÄąÄ˝ nie potrzebuje osobnej "ucieczki" Ă˘â‚¬â€ť samolot po
  // prostu naturalnie podskakuje/przechyla siĂ„â„˘ zgodnie z siÄąâ€šami z kaÄąÄ˝dej goleni.
  // Ta funkcja zostaje wyÄąâ€šĂ„â€¦cznie dla PRAWDZIWYCH zderzeÄąâ€ž: twarde lĂ„â€¦dowanie
  // (duÄąÄ˝a prĂ„â„˘dkoÄąâ€şĂ„â€ˇ pionowa) albo wlecenie w stromĂ„â€¦ Äąâ€şcianĂ„â„˘ terenu przy duÄąÄ˝ej
  // prĂ„â„˘dkoÄąâ€şci poziomej.)
  applyBounce(gear) {
    if (this._bounceCooldown > 0) return false;
    const impactVy = Math.max(0, -this.vel.y);
    const best = this.bestGearPoint(gear);
    const off = best.point.offset;
    const { lat: glat, lon: glon } = offsetGeo(this.lat, this.lon, off.x, -off.z);
    const normal = this.terrainNormalAt(glat, glon);
    const slopeAngleDeg = Math.acos(Math.max(-1, Math.min(1, normal.y))) * 180 / Math.PI;

    const velIntoSlope = -this.vel.dot(normal);
    const hardVertical  = impactVy >= BOUNCE_TRIGGER_VSPEED;
    const hardIntoSlope = velIntoSlope >= BOUNCE_TRIGGER_HSPEED_INTO_SLOPE && slopeAngleDeg >= BOUNCE_INTO_SLOPE_MIN_DEG;
    if (!hardVertical && !hardIntoSlope) return false;

    const vNormal  = normal.clone().multiplyScalar(this.vel.dot(normal));
    const vTangent = this.vel.clone().sub(vNormal);
    const incomingNormalSpeed = Math.max(0, -this.vel.dot(normal));
    const flatGroundScale = slopeAngleDeg < 8 ? 0.35 : slopeAngleDeg < 16 ? 0.6 : 1.0;
    const bounceSpeed = Math.max(incomingNormalSpeed * BOUNCE_RESTITUTION * flatGroundScale, BOUNCE_MIN_UP_SPEED * flatGroundScale);
    const newVel = vTangent.multiplyScalar(BOUNCE_TANGENT_DAMPING).addScaledVector(normal, bounceSpeed);

    this.vel.copy(newVel);
    this._bounceCooldown = 0.35;
    this.onGround = false;
    this._nearGroundZone = true;

    if (window.DEBUG_GEAR) {
      console.warn(`[BOUNCE] Twarde uderzenie w teren (${best.key}) Ă˘â‚¬â€ť impactVy=${impactVy.toFixed(1)} m/s, velIntoSlope=${velIntoSlope.toFixed(1)} m/s, slope=${slopeAngleDeg.toFixed(1)}Ă‚Â° Ă˘â€ â€™ odbicie ${bounceSpeed.toFixed(1)} m/s wzdÄąâ€šuÄąÄ˝ normalnej.`);
    }
    return true;
  }

  // CaÄąâ€ša integracja pozycji (lat/lon/altM) dzieje siĂ„â„˘ wewnĂ„â€¦trz physicsUpdate()
  // (bo tam liczymy realne przyspieszenia z siÄąâ€š/momentÄ‚Ĺ‚w) Ă˘â‚¬â€ť ten override MUSI
  // zostaĂ„â€ˇ pusty, inaczej odziedziczony Entity.integrate() sprÄ‚Ĺ‚bowaÄąâ€šby ruszyĂ„â€ˇ
  // samolotem przez nieuÄąÄ˝ywane tu this.velNED (ktÄ‚Ĺ‚rego A321Entity nigdy nie
  // ustawia), co albo nic by nie robiÄąâ€šo, albo psuÄąâ€šo pozycjĂ„â„˘ w zaleÄąÄ˝noÄąâ€şci od
  // stanu velNED odziedziczonego z Entity.
  integrate(dt) {}

  get worldPos() {
    return geoToWorld(this.lat, this.lon, this.altM * DEM_EXAG);
  }

  syncMesh() {
    if (!this.mesh) return;
    const p = this.worldPos;
    this.mesh.position.copy(p);
    this.mesh.rotation.set(-this.pitchRad, this.yawRad, this.rollRad, 'YXZ');
  }

  physicsUpdate(dt, input) {
    const dtCap = Math.min(dt, 0.05);
    if (this._bounceCooldown > 0) this._bounceCooldown = Math.max(0, this._bounceCooldown - dtCap);

    // Throttle: 0..1 = normalny zakres do przodu (bez zmian). PoniÄąÄ˝ej zera =
    // reverse thrust Ă˘â‚¬â€ť TYLKO na ziemi, dokÄąâ€šadnie jak w prawdziwym samolocie
    // (przepustnice reverse sĂ„â€¦ mechanicznie zablokowane w locie, odblokowuje
    // je czujnik obciĂ„â€¦ÄąÄ˝enia podwozia/"weight on wheels" po dotkniĂ„â„˘ciu pasa).
    // this.onGround pochodzi z POPRZEDNIEJ klatki (patrz komentarz o orientacji
    // wyÄąÄ˝ej) Ă˘â‚¬â€ť to ten sam, juÄąÄ˝ istniejĂ„â€¦cy wzorzec w tym pliku.
    if (input.throttleUp) this.throttle = Math.min(1, this.throttle + dtCap * 0.6);
    if (input.throttleDown) {
      const minThrottle = this.onGround ? -1 : 0;
      this.throttle = Math.max(minThrottle, this.throttle - dtCap * 0.8);
    }
    // Bezpiecznik: gdyby samolot oderwaÄąâ€š siĂ„â„˘ od ziemi z wybranym reverse
    // (np. odbicie/bounced landing), natychmiast wrÄ‚Ĺ‚Ă„â€ˇ do zera Ă˘â‚¬â€ť nie da siĂ„â„˘
    // fizycznie lataĂ„â€ˇ z wysuniĂ„â„˘tymi rewersorami.
    if (!this.onGround && this.throttle < 0) this.throttle = 0;

    // Rewersory potrzebujĂ„â€¦ chwili na fizyczne wysuniĂ„â„˘cie/schowanie (jak
    // translating cowl w prawdziwym silniku) Ă˘â‚¬â€ť ciĂ„â€¦g wsteczny narasta dopiero
    // wraz z reverserDeployFrac, nie skokowo. ChowajĂ„â€¦ siĂ„â„˘ szybciej niÄąÄ˝ siĂ„â„˘
    // wysuwajĂ„â€¦ (tak jak w realu Ă˘â‚¬â€ť bezpieczeÄąâ€žstwo przy go-around).
    const reverserTarget = (this.throttle < -0.001 && this.onGround) ? 1 : 0;
    const reverserRate = (reverserTarget > this.reverserDeployFrac) ? (dtCap / 1.6) : (dtCap / 0.9);
    this.reverserDeployFrac += Math.max(-reverserRate, Math.min(reverserRate, reverserTarget - this.reverserDeployFrac));

    // Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬ Wiatr: wektor 3D w ramie lokalnej fizyki (x=wschÄ‚Ĺ‚d,y=gÄ‚Ĺ‚ra,z=-pÄ‚Ĺ‚Äąâ€šnoc).
    // getWindVector3D daje gradient przyziemny + turbulencjĂ„â„˘ (patrz
    // sim-weather.js); getWindshearDelta daje ewentualny scenariusz testowy Ă˘â‚¬â€ť
    // liczony WZGLĂ„ÂDEM aktualnego kierunku lotu, wiĂ„â„˘c potrzebuje `_windForward`
    // (to samo co `forward` liczone niÄąÄ˝ej w tej funkcji, tylko wczeÄąâ€şniej Ă˘â‚¬â€ť
    // duplikacja tej jednej linijki jest taÄąâ€žsza niÄąÄ˝ przestawianie kolejnoÄąâ€şci
    // caÄąâ€šej, juÄąÄ˝ dostrojonej, reszty physicsUpdate).
    // UWAGA: to jedyne miejsce, gdzie this.vel (prĂ„â„˘dkoÄąâ€şĂ„â€ˇ wzglĂ„â„˘dem ZIEMI)
    // rozjeÄąÄ˝dÄąÄ˝a siĂ„â„˘ z prĂ„â„˘dkoÄąâ€şciĂ„â€¦ wzglĂ„â„˘dem POWIETRZA Ă˘â‚¬â€ť airRelVel/airspeed
    // niÄąÄ˝ej sÄąâ€šuÄąÄ˝Ă„â€¦ WYÄąÂĂ„â€žCZNIE aerodynamice (siÄąâ€ša noÄąâ€şna, opÄ‚Ĺ‚r, kĂ„â€¦t natarcia/
    // poÄąâ€şlizgu). Pozycja, prĂ„â„˘dkoÄąâ€şĂ„â€ˇ wzglĂ„â„˘dem ziemi (G/S), tarcie kÄ‚Ĺ‚Äąâ€š i V/S
    // dalej uÄąÄ˝ywajĂ„â€¦ this.vel bez zmian, bo to fizycznie poprawne Ă˘â‚¬â€ť wiatr nie
    // zmienia jak szybko koÄąâ€ša toczĂ„â€¦ siĂ„â„˘ po pasie ani jak szybko realnie
    // przemieszczamy siĂ„â„˘ nad ziemiĂ„â€¦.
    const _windForward = new THREE.Vector3(Math.sin(this.yawRad), 0, Math.cos(this.yawRad));
    const windVec3 = new THREE.Vector3(0, 0, 0);
    if (typeof weather !== 'undefined' && weather) {
      const w = weather.getWindVector3D(this.agl, dtCap);
      windVec3.set(w.x, w.y, w.z);
      this.windSpeedKt = Units.msToKt(w.speedMs);
      this.windDirDeg  = w.dirFromDeg;
      const wsD = weather.getWindshearDelta(dtCap);
      // UWAGA na znak: airRelVel = this.vel - windVec3 (patrz niÄąÄ˝ej), wiĂ„â„˘c
      // "dodatkowy headwind" (alongMs>0, ma ZWIĂ„ÂKSZAĂ„â€  airspeed) to wektor
      // wiatru PRZECIWNY do kierunku dziobu (powietrze pÄąâ€šynie od dziobu w
      // stronĂ„â„˘ ogona) Ă˘â‚¬â€ť stĂ„â€¦d minus. Sprawdzone na wprost: V=50 do przodu,
      // headwind=12 -> windVec=-12*forward -> airRelVel=(50-(-12))*forward
      // = 62 > 50. Bez minusa wyszÄąâ€šoby 38 (czyli de facto tailwind).
      windVec3.addScaledVector(_windForward, -wsD.alongMs);
      windVec3.y += wsD.vertMs;
    }
    this.windVec3 = windVec3; // do odczytu w HUD/debug (wektor CAÄąÂKOWITY, z windshearem)

    const airRelVel = this.vel.clone().sub(windVec3);
    const airspeed = airRelVel.length();
    const speedKt = Units.msToKt(airspeed);
    // groundSpeedKt: NAPRAWA Ă˘â‚¬â€ť to co dawniej byÄąâ€šo `speedKt` u autobrake'u i
    // groundSteerTrackFactor (niÄąÄ˝ej w tej funkcji) w rzeczywistoÄąâ€şci zawsze
    // chodziÄąâ€šo o prĂ„â„˘dkoÄąâ€şĂ„â€ˇ WZGLĂ„ÂDEM ZIEMI (kiedy jeszcze nie byÄąâ€šo wiatru,
    // airspeed==groundspeed, wiĂ„â„˘c rÄ‚Ĺ‚ÄąÄ˝nica nie byÄąâ€ša widoczna) Ă˘â‚¬â€ť teraz trzeba
    // je rozdzieliĂ„â€ˇ jawnie, bo silny wiatr mÄ‚Ĺ‚gÄąâ€šby inaczej faÄąâ€šszywie
    // rozÄąâ€šĂ„â€¦czaĂ„â€ˇ/zaÄąâ€šĂ„â€¦czaĂ„â€ˇ autobrake albo psuĂ„â€ˇ skrĂ„â„˘t na pasie.
    const groundSpeedKt = Units.msToKt(this.vel.length());

    // Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬ Autopilot: autothrust (SPD HOLD) Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬
    // P+I na bÄąâ€šĂ„â„˘dzie prĂ„â„˘dkoÄąâ€şci WZGLĂ„ÂDEM POWIETRZA (speedKt, patrz sekcja
    // wiatru wyÄąÄ˝ej) Ă˘â‚¬â€ť integrator jest tu waÄąÄ˝ny, bo bez niego autothrust
    // zostawiaÄąâ€šby staÄąâ€šy bÄąâ€šĂ„â€¦d prĂ„â„˘dkoÄąâ€şci przy headwindzie/tailwindzie albo przy
    // ciĂ„â„˘ÄąÄ˝szym samolocie (patrz system wagi). RozÄąâ€šĂ„â€¦cza siĂ„â„˘ przy rĂ„â„˘cznym
    // throttleUp/Down (pilot bierze stery) Ă˘â‚¬â€ť dokÄąâ€šadnie jak reszta osi AP.
    if (this.ap.master && this.ap.spdHold && !input.throttleUp && !input.throttleDown) {
      const spdErrKt = this.ap.targetSpdKt - speedKt; // dodatnie = za wolno, trzeba dodaĂ„â€ˇ mocy
      this._athrIntegral = Math.max(-AP_ATHR_INTEGRAL_MAX, Math.min(AP_ATHR_INTEGRAL_MAX,
        this._athrIntegral + spdErrKt * AP_SPD_KI * dtCap));
      this.throttle = Math.max(0, Math.min(1, AP_SPD_KP * spdErrKt + this._athrIntegral));
      // Autothrust nie wchodzi w reverse ani nie rusza rewersorÄ‚Ĺ‚w Ă˘â‚¬â€ť to
      // manewr WYÄąÂĂ„â€žCZNIE rĂ„â„˘czny (real A320/321 rodzina dziaÄąâ€ša tak samo).
    } else if ((input.throttleUp || input.throttleDown) && this.ap.master) {
      this.ap.spdHold = false; // rĂ„â„˘czne przejĂ„â„˘cie gazu rozÄąâ€šĂ„â€¦cza autothrust
    }

    const pitchInput = input.pitch;
    let rollInput  = input.roll;
    const yawInput   = input.yaw;
    // ZapamiĂ„â„˘tane dla HUD (sim-hud.js) Ă˘â‚¬â€ť czy hamulce main gear sĂ„â€¦ w tej
    // klatce faktycznie zaciÄąâ€şniĂ„â„˘te (manualnie albo parking brake). Autobrake
    // ma osobny wskaÄąĹźnik (this.autobrakeLevel), bo dziaÄąâ€ša niezaleÄąÄ˝nie.
    this.brakesActiveDisplay = !!input.brakes || this.parkingBrake;

    // Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬ Orientacja z POPRZEDNIEGO kroku Ă˘â‚¬â€ť z niej liczymy WSZYSTKIE siÄąâ€šy i momenty
    // w tej klatce (kĂ„â€¦ty same zmieniĂ„â€¦ siĂ„â„˘ dopiero na koÄąâ€žcu funkcji, gdy
    // zintegrujemy przyspieszenia kĂ„â€¦towe). To poprawna kolejnoÄąâ€şĂ„â€ˇ dla bryÄąâ€šy
    // sztywnej: siÄąâ€šy zaleÄąÄ˝Ă„â€¦ od aktualnego stanu, dopiero potem stan siĂ„â„˘
    // aktualizuje na podstawie tych siÄąâ€š Ă˘â‚¬â€ť a nie odwrotnie. Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬
    const forward = new THREE.Vector3(Math.sin(this.yawRad), 0, Math.cos(this.yawRad));
    const noseDir = new THREE.Vector3(
      forward.x * Math.cos(this.pitchRad),
      Math.sin(this.pitchRad),
      forward.z * Math.cos(this.pitchRad)
    ).normalize();
    const worldUp  = new THREE.Vector3(0, 1, 0);
    const rightVec = new THREE.Vector3().crossVectors(worldUp, forward).normalize();
    const rollQ    = new THREE.Quaternion().setFromAxisAngle(noseDir, this.rollRad);
    const wingRight = rightVec.clone().applyQuaternion(rollQ);
    const acUp      = new THREE.Vector3().crossVectors(noseDir, wingRight).normalize();

    // PrĂ„â„˘dkoÄąâ€şĂ„â€ˇ kĂ„â€¦towa bryÄąâ€šy W ÄąĹˇWIECIE, z aktualnych (skalarnych) pitchRate/
    // rollRate/yawRate Ă˘â‚¬â€ť oÄąâ€ş pitch to -wingRight (patrz derywacja przy noseDir.y),
    // oÄąâ€ş roll to +noseDir (zgodnie ze standardowĂ„â€¦ reguÄąâ€šĂ„â€¦ prawej dÄąâ€šoni, bo
    // rollQ powyÄąÄ˝ej juÄąÄ˝ UÄąÄ˝YWA +this.rollRad, nie -this.rollRad Ă˘â‚¬â€ť NAPRAWA:
    // zweryfikowane numerycznie, ÄąÄ˝e ten znak zgadza siĂ„â„˘ z mesh.rotation.set(...,
    // rollRad, 'YXZ') uÄąÄ˝ywanym w syncMesh(); poprzednia wersja z minusem dawaÄąâ€ša
    // wingRight/acUp DOKÄąÂADNIE PRZECIWNE do tego co widziaÄąâ€š gracz na ekranie Ă˘â‚¬â€ť
    // stĂ„â€¦d zgÄąâ€šoszony bug "przechyla siĂ„â„˘ w lewo poprawnie, ale skrĂ„â„˘ca w prawo").
    const omegaWorld = wingRight.clone().multiplyScalar(-this.pitchRate)
      .addScaledVector(noseDir, this.rollRate)
      .addScaledVector(worldUp, this.yawRate);

    // Rzutuje wektor siÄąâ€šy ze Äąâ€şwiata na lokalne osie samolotu Ă˘â‚¬â€ť wzory na moment
    // (_pitchTorque/_rollTorque/_yawTorque) zakÄąâ€šadajĂ„â€¦, ÄąÄ˝e i ramiĂ„â„˘ (r), i siÄąâ€ša
    // (F) sĂ„â€¦ wyraÄąÄ˝one w TYM SAMYM lokalnym ukÄąâ€šadzie.
    const toLocal = (v) => ({ x: v.dot(wingRight), y: v.dot(acUp), z: v.dot(noseDir) });

    const totalForce = new THREE.Vector3(0, -A321_PARAMS.mass * G_ACC, 0); // grawitacja Ă˘â‚¬â€ť dziaÄąâ€ša w CG, nie daje momentu
    // Kierunek "do gÄ‚Ĺ‚ry" liczony wzglĂ„â„˘dem PRĂ„ÂDKOÄąĹˇCI, nie wzglĂ„â„˘dem pitchu
    // samolotu Ă˘â‚¬â€ť uÄąÄ˝ywany dla siÄąâ€šy noÄąâ€şnej skrzydÄąâ€ša i usterzenia (patrz NAPRAWA
    // przy _computeWindUp wyÄąÄ˝ej). airspeed jest juÄąÄ˝ policzony na poczĂ„â€¦tku
    // physicsUpdate.
    const windUp = _computeWindUp(airRelVel, wingRight, acUp, airspeed);
    let torquePitch = 0, torqueRoll = 0, torqueYaw = 0;

    // Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬ Aerodynamika skrzydÄąâ€ša: siÄąâ€ša noÄąâ€şna + opÄ‚Ĺ‚r, jak wczeÄąâ€şniej, ale teraz
    // przyÄąâ€šoÄąÄ˝ona w WING_AC (blisko CG) Ă˘â‚¬â€ť daje wiĂ„â„˘c teÄąÄ˝ niewielki moment pitch,
    // zamiast dziaÄąâ€šaĂ„â€ˇ "w prÄ‚Ĺ‚ÄąÄ˝ni" bez wpÄąâ€šywu na obrÄ‚Ĺ‚t. Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬
    const fpa = airspeed > 2 ? Math.asin(Math.max(-1, Math.min(1, airRelVel.y / airspeed))) : 0;
    const alpha = this.pitchRad - fpa;

    const flap = this.flaps;
    const isStalling = !this.onGround && Math.abs(alpha) > A321_PARAMS.flapStall[flap];
    let cl;
    if (isStalling) {
      const over = Math.abs(alpha) - A321_PARAMS.flapStall[flap];
      cl = Math.sign(alpha) * Math.max(0.15, (A321_PARAMS.clMax + A321_PARAMS.flapCl[flap]) - over * 4.0);
    } else {
      cl = A321_PARAMS.cl0 + A321_PARAMS.flapCl[flap] + A321_PARAMS.clAlpha * alpha;
    }
    if (this.spoilers) cl -= A321_PARAMS.spoilerLiftLoss;
    const groundRun = this.onGround && this.gearDown;
    const liftScale = groundRun ? A321_PARAMS.groundRunLiftScale : 1.0;
    const dragScale = groundRun ? A321_PARAMS.groundRunDragScale : 1.0;
    cl *= liftScale;
    cl = Math.max(-0.3, Math.min(A321_PARAMS.clMax + A321_PARAMS.flapCl[flap], cl));

    const groundH = this.groundHeight();
    const gearOffset = this.gearDown ? 3.15 : 0.5;
    const agl_now = this.altM - groundH - gearOffset;
    const gef = groundEffectFactor(agl_now, A321_PARAMS.span);
    const cdi = (cl * cl) / (Math.PI * A321_PARAMS.eOswald * A321_PARAMS.AR) * gef;
    const cd  = (A321_PARAMS.cdMin + A321_PARAMS.flapCd[flap] + (this.gearDown ? A321_PARAMS.cdGear : 0)
              + cdi + A321_PARAMS.cdAlpha * alpha * alpha + (this.spoilers ? A321_PARAMS.spoilerCd : 0)) * dragScale;

    const q       = 0.5 * RHO * airspeed * airspeed;
    const liftMag = q * A321_PARAMS.wingArea * cl;
    const dragMag = q * A321_PARAMS.wingArea * Math.max(0, cd);

    const liftVec = windUp.clone().multiplyScalar(liftMag);
    const dragVec = airspeed > 0.1 ? airRelVel.clone().normalize().multiplyScalar(-dragMag) : new THREE.Vector3();
    totalForce.add(liftVec).add(dragVec);
    { const Fl = toLocal(liftVec);
      torquePitch += _pitchTorque(WING_AC, Fl);
      torqueRoll  += _rollTorque(WING_AC, Fl); }

    // Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬ CiĂ„â€¦g silnikÄ‚Ĺ‚w Ă˘â‚¬â€ť przyÄąâ€šoÄąÄ˝ony POD CG (THRUST_PT.y<0), wiĂ„â„˘c zmiana mocy
    // silnikÄ‚Ĺ‚w daje (maÄąâ€šy, ale prawdziwy) moment pitch, dokÄąâ€šadnie jak na
    // realnym samolocie z silnikami podwieszonymi pod skrzydÄąâ€šami. Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬
    // throttle>=0: normalny ciĂ„â€¦g do przodu (bez zmian wzglĂ„â„˘dem wczeÄąâ€şniej).
    // throttle<0: reverse thrust Ă˘â‚¬â€ť ograniczony do A321_REVERSE_THRUST_FRAC
    // maksymalnego ciĂ„â€¦gu i narastajĂ„â€¦cy wraz z reverserDeployFrac (fizyczne
    // wysuwanie translating cowl, patrz throttle/reverser wyÄąÄ˝ej w tej funkcji).
    const thrustScale = (groundRun && this.throttle >= 0) ? A321_PARAMS.groundRunThrustBoost : 1.0;
    const thrustMagFwd = this.throttle >= 0
      ? this.throttle * A321_PARAMS.maxThrust
      : this.throttle * A321_PARAMS.maxThrust * A321_REVERSE_THRUST_FRAC * this.reverserDeployFrac;
    const thrustVec = noseDir.clone().multiplyScalar(thrustMagFwd * thrustScale);
    totalForce.add(thrustVec);
    // Moment liczymy z NIEPODBITEGO ciĂ„â€¦gu (thrustMagFwd, BEZ
    // groundRunThrustBoost) Ă˘â‚¬â€ť boost naziemny to umowne wzmocnienie
    // przyspieszenia dla lepszego odczucia rozbiegu, nie prawdziwy wzrost mocy
    // silnikÄ‚Ĺ‚w; uÄąÄ˝ycie go teÄąÄ˝ tutaj sztucznie potĂ„â„˘gowaÄąâ€šoby "power pitch" Ä‚â€”2.2,
    // prowadzĂ„â€¦c do samoczynnego unoszenia przedniego koÄąâ€ša przy wiĂ„â„˘kszej
    // przepustnicy, bez udziaÄąâ€šu pilota (patrz NAPRAWA przy THRUST_PT).
    const thrustTorqueVec = noseDir.clone().multiplyScalar(thrustMagFwd);
    { const Ft = toLocal(thrustTorqueVec);
      torquePitch += _pitchTorque(THRUST_PT, Ft); }

    // Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬ Ster wysokoÄąâ€şci: PRAWDZIWA siÄąâ€ša na usterzeniu ogonowym, zaleÄąÄ˝na od
    // lokalnego kĂ„â€¦ta natarcia usterzenia i od wychylenia steru Ă˘â‚¬â€ť TO ZASTĂ„ÂPUJE
    // dawne bezpoÄąâ€şrednie ustawianie pitchRate z inputu pilota. Teraz input
    // steruje POWIERZCHNIĂ„â€ž (elevatorDeflection), powierzchnia wytwarza siÄąâ€šĂ„â„˘
    // (tailForceVec), a siÄąâ€ša Ä‚â€” ramiĂ„â„˘ (TAIL_AC.z, daleko za CG) daje moment,
    // ktÄ‚Ĺ‚ry dopiero na koÄąâ€žcu funkcji zamienia siĂ„â„˘ w obrÄ‚Ĺ‚t Ă˘â‚¬â€ť dokÄąâ€šadnie jak w
    // prawdziwym samolocie.
    //
    // Lokalny kĂ„â€¦t natarcia usterzenia = kĂ„â€¦t natarcia skrzydÄąâ€ša + wkÄąâ€šad z
    // prĂ„â„˘dkoÄąâ€şci kĂ„â€¦towej pitch: punkt na ogonie (daleko za CG) fizycznie
    // porusza siĂ„â„˘ w gÄ‚Ĺ‚rĂ„â„˘/dÄ‚Ĺ‚Äąâ€š razem z obrotem samolotu (efekt "huÄąâ€ştawki" wokÄ‚Ĺ‚Äąâ€š
    // CG), co zmienia LOKALNY wzglĂ„â„˘dny wiatr odczuwany przez usterzenie. To
    // jest PRAWDZIWE ÄąĹźrÄ‚Ĺ‚dÄąâ€šo aerodynamicznego tÄąâ€šumienia pitch (odpowiednik
    // wspÄ‚Ĺ‚Äąâ€šczynnika Cmq z podrĂ„â„˘cznikÄ‚Ĺ‚w mechaniki lotu) Ă˘â‚¬â€ť wynika wprost z
    // geometrii (TAIL_AC.z), nie z ÄąÄ˝adnej wymyÄąâ€şlonej staÄąâ€šej tÄąâ€šumienia.
    //
    // NAPRAWA (zgÄąâ€šoszone: "strzaÄąâ€ška w dÄ‚Ĺ‚Äąâ€š robi ÄąÄ˝e samolot leci w gÄ‚Ĺ‚rĂ„â„˘"): minus
    // przed pitchInput jest tu CELOWY i KONIECZNY Ă˘â‚¬â€ť "ciĂ„â€¦gniĂ„â„˘cie za drĂ„â€¦ÄąÄ˝ek"
    // (pitchInput>0, strzaÄąâ€ška w gÄ‚Ĺ‚rĂ„â„˘) musi wychyliĂ„â€ˇ ster tak, by usterzenie
    // wytworzyÄąâ€šo MNIEJSZĂ„â€ž/ujemnĂ„â€¦ siÄąâ€šĂ„â„˘ (dziaÄąâ€šajĂ„â€¦cĂ„â€¦ w dÄ‚Ĺ‚Äąâ€š, za CG) Ă˘â‚¬â€ť to WÄąÂAÄąĹˇNIE
    // podnosi nos (pchniĂ„â„˘cie w dÄ‚Ĺ‚Äąâ€š za osiĂ„â€¦ obrotu podnosi przedniĂ„â€¦ czĂ„â„˘Äąâ€şĂ„â€ˇ),
    // dokÄąâ€šadnie jak wychylenie steru wysokoÄąâ€şci w gÄ‚Ĺ‚rĂ„â„˘ w prawdziwym samolocie.
    // Bez tego minusa dziaÄąâ€šaÄąâ€šo odwrotnie: strzaÄąâ€ška w gÄ‚Ĺ‚rĂ„â„˘ pochylaÄąâ€ša nos w dÄ‚Ĺ‚Äąâ€š.
    // Doliczamy teÄąÄ˝ attitude hold (patrz PITCH_HOLD_KP/KD niÄąÄ˝ej) Ă˘â‚¬â€ť tak jak w
    // prawdziwym samolocie, "zerowe" wychylenie steru to trym, nie zawsze
    // dosÄąâ€šownie zero stopni.
    const elevatorDeflection = -pitchInput * ELEVATOR_MAX_RAD + this.pitchTrim;
    // Rozdzielone na czĂ„â„˘Äąâ€şĂ„â€ˇ STATYCZNĂ„â€ž (kĂ„â€¦t natarcia samolotu, mnoÄąÄ˝ona przez
    // sÄąâ€šaby TAIL_CL_ALPHA_STATIC Ă˘â‚¬â€ť to "ile pitch chce wrÄ‚Ĺ‚ciĂ„â€ˇ do trymu sam")
    // i czĂ„â„˘Äąâ€şĂ„â€ˇ RATE (wkÄąâ€šad z prĂ„â„˘dkoÄąâ€şci kĂ„â€¦towej pitch, mnoÄąÄ˝ona przez peÄąâ€šny
    // TAIL_CL_ALPHA_RATE Ă˘â‚¬â€ť to czyste tÄąâ€šumienie oscylacji, patrz NAPRAWA przy
    // TAIL_CL_ALPHA_STATIC/RATE wyÄąÄ˝ej).
    const tailAlphaStatic = alpha;
    const tailAlphaRateDamp = -(TAIL_AC.z * this.pitchRate) / Math.max(airspeed, 5);
    const tailCl = TAIL_CL_ALPHA_STATIC * tailAlphaStatic + TAIL_CL_ALPHA_RATE * tailAlphaRateDamp
                 + ELEVATOR_CL_PER_RAD * elevatorDeflection;
    const tailForceVec = windUp.clone().multiplyScalar(q * TAIL_AREA * tailCl);
    totalForce.add(tailForceVec);
    { const Ft2 = toLocal(tailForceVec);
      torquePitch += _pitchTorque(TAIL_AC, Ft2); }
    // Dodatkowe tÄąâ€šumienie pitch (patrz PITCH_DAMPING_GAIN) Ă˘â‚¬â€ť ta sama,
    // standardowa forma co tÄąâ€šumienie roll niÄąÄ˝ej (qĂ‚Â·SĂ‚Â·LĂ‚Ë›Ă‚Â·rate/(2V), tu z
    // dÄąâ€šugoÄąâ€şciĂ„â€¦ kadÄąâ€šuba zamiast rozpiĂ„â„˘toÄąâ€şci skrzydeÄąâ€š jako charakterystycznĂ„â€¦
    // dÄąâ€šugoÄąâ€şciĂ„â€¦ dla osi pitch).
    torquePitch -= PITCH_DAMPING_GAIN * q * A321_PARAMS.wingArea * A321_FUSELAGE_LEN * A321_FUSELAGE_LEN
                 * this.pitchRate / (2 * Math.max(airspeed, 5));

    // Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬ Autopilot: oÄąâ€ş przechylenia (HDG HOLD) Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬
    // Kaskada: bÄąâ€šĂ„â€¦d kursu -> cel przechylenia (P, przyciĂ„â„˘ty do AP_MAX_BANK_DEG)
    // -> PD na bÄąâ€šĂ„â„˘dzie przechylenia -> podstawienie w miejsce rĂ„â„˘cznego
    // rollInput (tu NIE ma odpowiednika pitchHoldTarget/PD do ponownego uÄąÄ˝ycia
    // Ă˘â‚¬â€ť oÄąâ€ş przechylenia nie miaÄąâ€ša wczeÄąâ€şniej ÄąÄ˝adnego auto-trymu, wiĂ„â„˘c
    // autopilot komenderuje "wychyÄąâ€š lotki" bezpoÄąâ€şrednio, tak jak zrobiÄąâ€šby to
    // pilot drĂ„â€¦ÄąÄ˝kiem).
    if (this.ap.master && this.ap.hdgHold && Math.abs(input.roll) < AP_MANUAL_OVERRIDE_DEADZONE) {
      const hdgErrDeg = ((this.ap.targetHdgDeg - this.heading + 540) % 360) - 180; // -180..+180, dodatnie = cel na prawo
      const targetBankDeg = Math.max(-AP_MAX_BANK_DEG, Math.min(AP_MAX_BANK_DEG, hdgErrDeg * AP_HDG_KP));
      const bankErrRad = (targetBankDeg * Math.PI / 180) - this.rollRad;
      rollInput = Math.max(-1, Math.min(1, AP_ROLL_KP * bankErrRad - AP_ROLL_KD * this.rollRate));
    } else if (Math.abs(input.roll) >= AP_MANUAL_OVERRIDE_DEADZONE && this.ap.master && this.ap.hdgHold) {
      // RĂ„â„˘czne przejĂ„â„˘cie steru rozÄąâ€šĂ„â€¦cza autopilota na osi przechylenia
      this.ap.hdgHold = false;
    }

    // Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬ Lotki: moment przechylajĂ„â€¦cy wprost ze standardowego wzoru
    // aerodynamicznego (ÄŽâ€ž = qĂ‚Â·SĂ‚Â·rozpiĂ„â„˘toÄąâ€şĂ„â€ˇĂ‚Â·Cl_ĂŽÂ´aĂ‚Â·ĂŽÂ´a) Ă˘â‚¬â€ť ailerony nie majĂ„â€¦ jednego
    // "ramienia" (dziaÄąâ€šajĂ„â€¦ rÄ‚Ĺ‚ÄąÄ˝nicowo na caÄąâ€šej rozpiĂ„â„˘toÄąâ€şci skrzydeÄąâ€š), wiĂ„â„˘c
    // liczymy moment wprost zamiast punktowej siÄąâ€šy. Plus tÄąâ€šumienie
    // przechylenia (odpowiednik Clp) tĂ„â€¦ samĂ„â€¦, standardowĂ„â€¦ metodĂ„â€¦. Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬
    const aileronDeflection = rollInput * AILERON_MAX_RAD;
    torqueRoll += q * A321_PARAMS.wingArea * A321_PARAMS.span * AILERON_CL_PER_RAD * aileronDeflection;
    torqueRoll -= ROLL_DAMPING_GAIN * q * A321_PARAMS.wingArea * A321_PARAMS.span * A321_PARAMS.span
                * this.rollRate / (2 * Math.max(airspeed, 5));

    // Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬ Statecznik pionowy + ster kierunku: analogicznie do usterzenia
    // poziomego Ă˘â‚¬â€ť prawdziwa siÄąâ€ša boczna zaleÄąÄ˝na od kĂ„â€¦ta Äąâ€şlizgu (beta) + wkÄąâ€šadu
    // z yawRate (tÄąâ€šumienie odchylenia, ten sam mechanizm "huÄąâ€ştawki" co przy
    // pitch) i od wychylenia steru kierunku. SiÄąâ€ša Ä‚â€” ramiĂ„â„˘ (FIN_AC.z) daje
    // moment yaw; FIN_AC jest dodatkowo PODNIESIONY nad oÄąâ€ş przechylenia
    // (FIN_AC.y > 0), wiĂ„â„˘c ta sama siÄąâ€ša naturalnie sprzĂ„â„˘ga siĂ„â„˘ teÄąÄ˝ z rollem Ă˘â‚¬â€ť
    // to prawdziwy, znany efekt uboczny sterowania kierunkiem (nie coÄąâ€ş
    // dodanego sztucznie na siÄąâ€šĂ„â„˘). Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬
    const beta = Math.atan2(airRelVel.dot(wingRight), Math.max(airspeed, 0.5));
    // NAPRAWA (zgÄąâ€šoszone: "samolot sam bez controls sie buja lewo prawo w
    // locie Ă˘â‚¬â€ť heading, nie roll"): wkÄąâ€šad yawRate do finBeta musi mieĂ„â€ˇ
    // PRZECIWNY znak wzglĂ„â„˘dem tego, jak wchodzi do finForceVec, niÄąÄ˝ wkÄąâ€šad
    // samego beta (skĂ„â€¦d ta asymetria: kierunek "dodatniego" Cl dla statecznika
    // pionowego wzglĂ„â„˘dem wingRight okazuje siĂ„â„˘ przeciwny do kierunku "dodatniego"
    // Cl dla usterzenia poziomego wzglĂ„â„˘dem acUp, mimo analogicznej geometrii).
    // Ze STARYM znakiem (jak dla pitch: `beta - FIN_AC.z*yawRate/V`) statyczna
    // statecznoÄąâ€şĂ„â€ˇ kierunkowa (Äąâ€şlizg Ă˘â€ â€™ moment przywracajĂ„â€¦cy) wychodziÄąâ€ša poprawnie,
    // ale tÄąâ€šumienie yaw wychodziÄąâ€šo Z PRZECIWNYM znakiem Ă˘â‚¬â€ť DODATNIE sprzĂ„â„˘ÄąÄ˝enie
    // zwrotne zamiast tÄąâ€šumienia, czyli samopodtrzymujĂ„â€¦ce/narastajĂ„â€¦ce koÄąâ€šysanie
    // w yaw bez ÄąÄ˝adnego inputu. Zweryfikowane numerycznie (Node, konkretne
    // wartoÄąâ€şci): stary wzÄ‚Ĺ‚r dawaÄąâ€š torqueYaw=+121380 dla yawRate=+0.01Ă‚Â·V (powinno
    // byĂ„â€ˇ ujemne Ă˘â‚¬â€ť tÄąâ€šumienie), ten (z plusem) daje -121380 (poprawnie), a
    // statyczny Äąâ€şlizg beta=+0.1 nadal daje poprawne +71400 w OBU wersjach.
    const finBeta = beta + (FIN_AC.z * this.yawRate) / Math.max(airspeed, 5);
    const rudderDeflection = yawInput * RUDDER_MAX_RAD;
    const finCl = FIN_CL_BETA * finBeta + RUDDER_CL_PER_RAD * rudderDeflection;
    const finForceVec = wingRight.clone().multiplyScalar(-q * FIN_AREA * finCl);
    totalForce.add(finForceVec);
    { const Ff = toLocal(finForceVec);
      torqueYaw  += _yawTorque(FIN_AC, Ff);
      torqueRoll += _rollTorque(FIN_AC, Ff); }
    // Dodatkowe tÄąâ€šumienie yaw (patrz YAW_DAMPING_GAIN) Ă˘â‚¬â€ť ta sama, standardowa
    // forma co PITCH_DAMPING_GAIN/ROLL_DAMPING_GAIN (qĂ‚Â·SĂ‚Â·LĂ‚Ë›Ă‚Â·rate/(2V), tu z
    // dÄąâ€šugoÄąâ€şciĂ„â€¦ kadÄąâ€šuba jako charakterystycznĂ„â€¦ dÄąâ€šugoÄąâ€şciĂ„â€¦ dla osi yaw).
    torqueYaw -= YAW_DAMPING_GAIN * q * A321_PARAMS.wingArea * A321_FUSELAGE_LEN * A321_FUSELAGE_LEN
               * this.yawRate / (2 * Math.max(airspeed, 5));

    // Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬ Kontakt z ziemiĂ„â€¦: 3 niezaleÄąÄ˝ne punkty (przednie koÄąâ€šo, lewe/prawe
    // gÄąâ€šÄ‚Ĺ‚wne), kaÄąÄ˝dy z WÄąÂASNĂ„â€ž, w peÄąâ€šni fizycznĂ„â€¦ siÄąâ€šĂ„â€¦ sprĂ„â„˘ÄąÄ˝ysto-tÄąâ€šumiĂ„â€¦cĂ„â€¦
    // (wzdÄąâ€šuÄąÄ˝ PRAWDZIWEJ normalnej terenu Ă˘â‚¬â€ť obsÄąâ€šuguje zbocza bez osobnej
    // logiki) + siÄąâ€šĂ„â€¦ tarcia opony (toczenie/hamowanie + przyczepnoÄąâ€şĂ„â€ˇ boczna,
    // w tym skrĂ„â„˘t przedniego koÄąâ€ša). To CAÄąÂKOWICIE zastĂ„â„˘puje dawne
    // settleOnGear() (ktÄ‚Ĺ‚re sztucznie "dociĂ„â€¦gaÄąâ€šo" pitch/roll do kĂ„â€¦ta terenu
    // przez blendowanie) Ă˘â‚¬â€ť teraz kĂ„â€¦t samolotu na ziemi jest CZYSTYM WYNIKIEM
    // momentÄ‚Ĺ‚w z tych siÄąâ€š, dokÄąâ€šadnie jak w prawdziwym samolocie: jeÄąâ€şli
    // przednie koÄąâ€šo naciska mocniej niÄąÄ˝ gÄąâ€šÄ‚Ĺ‚wne, to WÄąÂAÄąĹˇNIE ta rÄ‚Ĺ‚ÄąÄ˝nica siÄąâ€š
    // (nie ÄąÄ˝aden "target kĂ„â€¦ta") obraca samolot. Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬
    if (this.gearDown && !this.onGround && !this._nearGroundZone) {
      const mid = this.sampleGearPoint(GEAR_MAIN_MID, noseDir, wingRight, acUp, 'mid');
      if (-mid.pen < GEAR_FAR_CHECK_ENTER_AGL) this._nearGroundZone = true;
    }
    let gear = null;
    if (this.gearDown && (this.onGround || this._nearGroundZone)) {
      gear = this.sampleGear(noseDir, wingRight, acUp);
    }
    if (this.gearDown && !this.onGround && this._nearGroundZone && gear) {
      const mainAgl = -((gear.left.pen + gear.right.pen) / 2);
      if (mainAgl > GEAR_FAR_CHECK_EXIT_AGL) this._nearGroundZone = false;
    }

    let bounced = false;
    if (gear) {
      const gearContact = Math.max(gear.nose.pen, gear.left.pen, gear.right.pen) >= 0;
      // Twarde uderzenie (lĂ„â€¦dowanie z duÄąÄ˝Ă„â€¦ prĂ„â„˘dkoÄąâ€şciĂ„â€¦ pionowĂ„â€¦, albo wlecenie w
      // strome zbocze przy duÄąÄ˝ej prĂ„â„˘dkoÄąâ€şci) to prawdziwe zderzenie, nie zwykÄąâ€še
      // osiadanie na zawieszeniu Ă˘â‚¬â€ť patrz applyBounce().
      if (gearContact) bounced = this.applyBounce(gear);

      if (!bounced) {
        // Autobrake: automatyczne hamowanie kÄ‚Ĺ‚Äąâ€š gÄąâ€šÄ‚Ĺ‚wnych po lĂ„â€¦dowaniu, bez
        // udziaÄąâ€šu pilota. RozÄąâ€šĂ„â€¦cza siĂ„â„˘ gdy: pilot sam hamuje (override Ă˘â‚¬â€ť
        // manualny hamulec zawsze wygrywa), dodaje moc silnika (go-around),
        // albo prĂ„â„˘dkoÄąâ€şĂ„â€ˇ spadnie blisko koÄąâ€šowania (jak w realu).
        const autobrakeActive = this.autobrakeLevel !== 'OFF' && this.onGround
          && !input.brakes && this.throttle <= 0.05 && groundSpeedKt > AUTOBRAKE_MIN_SPEED_KT;
        const autobrakeMuRoll = TIRE_ROLLING_MU
          + (TIRE_BRAKE_MU - TIRE_ROLLING_MU) * (AUTOBRAKE_MU_FRAC[this.autobrakeLevel] ?? 0);

        for (const k of ['nose', 'left', 'right']) {
          const gp = gear[k];
          if (gp.pen < 0) continue; // koÄąâ€šo w powietrzu Ă˘â‚¬â€ť brak siÄąâ€šy z tej goleni
          const localOff = k === 'nose' ? GEAR_NOSE : k === 'left' ? GEAR_LEFT : GEAR_RIGHT;
          const isMain = k !== 'nose';
          const kSpring = isMain ? GEAR_K_MAIN : GEAR_K_NOSE;
          const cDamp   = isMain ? GEAR_C_MAIN : GEAR_C_NOSE;

          const { lat: glat, lon: glon } = offsetGeo(this.lat, this.lon, gp.offset.x, -gp.offset.z);
          const normal = this.terrainNormalAt(glat, glon);
          // PrĂ„â„˘dkoÄąâ€şĂ„â€ˇ TEGO PUNKTU (nie Äąâ€şrodka masy!) Ă˘â‚¬â€ť bryÄąâ€ša sztywna siĂ„â„˘ obraca,
          // wiĂ„â„˘c np. przednie koÄąâ€šo porusza siĂ„â„˘ szybciej pionowo niÄąÄ˝ CG podczas
          // rotacji. v = v_cg + ÄŽâ€° Ä‚â€” r.
          const vPoint = this.vel.clone().add(omegaWorld.clone().cross(gp.offset));
          const closingSpeed = -vPoint.dot(normal); // dodatnie = dalej siĂ„â„˘ zagÄąâ€šĂ„â„˘bia w teren

          let fN = kSpring * gp.pen + cDamp * closingSpeed;
          if (gp.pen > GEAR_SUSPENSION_TRAVEL) {
            fN += kSpring * GEAR_HARDSTOP_K_MULT * (gp.pen - GEAR_SUSPENSION_TRAVEL);
          }
          fN = Math.max(0, fN); // goleÄąâ€ž moÄąÄ˝e tylko PCHAĂ„â€ , nigdy "ciĂ„â€¦gnĂ„â€¦Ă„â€ˇ" w dÄ‚Ĺ‚Äąâ€š

          const normalForceVec = normal.clone().multiplyScalar(fN);

          // Tarcie opony: rozkÄąâ€šadamy prĂ„â„˘dkoÄąâ€şĂ„â€ˇ punktu na skÄąâ€šadowĂ„â€¦ w pÄąâ€šaszczyÄąĹźnie
          // stycznej do terenu, dalej na kierunek "toczenia" (wzdÄąâ€šuÄąÄ˝ samolotu)
          // i "boczny" (poÄąâ€şlizg/skrĂ„â„˘t).
          const vTangent = vPoint.clone().sub(normal.clone().multiplyScalar(vPoint.dot(normal)));
          const noseFlat = noseDir.clone().sub(normal.clone().multiplyScalar(noseDir.dot(normal)));
          if (noseFlat.lengthSq() > 1e-6) noseFlat.normalize();
          const rightFlat = wingRight.clone().sub(normal.clone().multiplyScalar(wingRight.dot(normal)));
          if (rightFlat.lengthSq() > 1e-6) rightFlat.normalize();
          const rollSpeed = vTangent.dot(noseFlat);
          const latSpeed  = vTangent.dot(rightFlat);

          // Hamulce: TYLKO koÄąâ€ša gÄąâ€šÄ‚Ĺ‚wne Ă˘â‚¬â€ť tak jak w realnym A321, przednie koÄąâ€šo
          // ma wyÄąâ€šĂ„â€¦cznie skrĂ„â„˘t (nosewheel steering), nigdy hamulec. KolejnoÄąâ€şĂ„â€ˇ
          // pierwszeÄąâ€žstwa: manualny hamulec pilota / parking brake > autobrake
          // > zwykÄąâ€še tarcie toczenia.
          let muRoll = TIRE_ROLLING_MU;
          if (isMain) {
            if (input.brakes || this.parkingBrake) muRoll = TIRE_BRAKE_MU;
            else if (autobrakeActive)              muRoll = autobrakeMuRoll;
          }
          const fRoll = -Math.max(-muRoll * fN, Math.min(muRoll * fN, TIRE_LONG_STIFF * rollSpeed));

          // Tylko przednie koÄąâ€šo ma komenderowany kĂ„â€¦t skrĂ„â„˘tu (nosewheel
          // steering) Ă˘â‚¬â€ť koÄąâ€ša gÄąâ€šÄ‚Ĺ‚wne zawsze po prostu "trzymajĂ„â€¦ siĂ„â„˘" kierunku
          // jazdy (czysta przyczepnoÄąâ€şĂ„â€ˇ boczna, docelowa prĂ„â„˘dkoÄąâ€şĂ„â€ˇ boczna = 0).
          let latTarget = 0;
          if (k === 'nose') {
            latTarget = Math.tan(yawInput * NOSEWHEEL_MAX_RAD) * Math.max(rollSpeed, 0)
                      * groundSteerTrackFactor(groundSpeedKt);
          }
          const fLat = -Math.max(-TIRE_LAT_GRIP_MU * fN, Math.min(TIRE_LAT_GRIP_MU * fN,
                        TIRE_LAT_STIFF * (latSpeed - latTarget)));

          const gearForceVec = normalForceVec
            .add(noseFlat.clone().multiplyScalar(fRoll))
            .add(rightFlat.clone().multiplyScalar(fLat));

          totalForce.add(gearForceVec);
          const Fg = toLocal(gearForceVec);
          torquePitch += _pitchTorque(localOff, Fg);
          torqueRoll  += _rollTorque(localOff, Fg);
          torqueYaw   += _yawTorque(localOff, Fg);
        }
      }
    } else if (!this.gearDown) {
      // LĂ„â€¦dowanie na kadÄąâ€šubie (podwozie schowane) Ă˘â‚¬â€ť uproszczony, POJEDYNCZY
      // punkt kontaktu w miejscu CG (nie 3 osobne punkty jak z wysuniĂ„â„˘tym
      // podwoziem), ale wciĂ„â€¦ÄąÄ˝ PRAWDZIWA siÄąâ€ša sprĂ„â„˘ÄąÄ˝ysto-tÄąâ€šumiĂ„â€¦ca, nie tylko
      // "przyklejenie".
      const penCg = groundH + gearOffset - this.altM;
      if (penCg > 0) {
        const kBelly = A321_PARAMS.mass * GEAR_SUSP_OMEGA_MAIN ** 2;
        const cBelly = 2 * GEAR_SUSP_ZETA_MAIN * GEAR_SUSP_OMEGA_MAIN * A321_PARAMS.mass;
        const fN = Math.max(0, kBelly * penCg - cBelly * this.vel.y);
        totalForce.y += fN;
        totalForce.x += -this.vel.x * A321_PARAMS.mass * 0.4;
        totalForce.z += -this.vel.z * A321_PARAMS.mass * 0.4;
      }
    }

    // Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬ Integracja: F=ma i ÄŽâ€ž=IĂ‚Â·ĂŽÂ±, w PEÄąÂNI fizycznie Ă˘â‚¬â€ť bez ÄąÄ˝adnych sztucznych
    // timerÄ‚Ĺ‚w oderwania, limitÄ‚Ĺ‚w pitch czy blendowania kĂ„â€¦ta do terenu. Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬
    if (!bounced) {
      const accel = totalForce.clone().divideScalar(A321_PARAMS.mass);
      this.vel.add(accel.multiplyScalar(dtCap));

      this.pitchRate += (torquePitch / A321_IYY) * dtCap;
      this.rollRate  += (torqueRoll  / A321_IXX) * dtCap;
      this.yawRate   += (torqueYaw   / A321_IZZ) * dtCap;

      // Uproszczenie kinematyczne (Äąâ€şwiadome, udokumentowane): przy umiarkowanych,
      // niesprzĂ„â„˘ÄąÄ˝onych kĂ„â€¦tach (loty liniowe, bez akrobacji) tempo zmiany kĂ„â€¦tÄ‚Ĺ‚w
      // Eulera Ă˘â€°Â prĂ„â„˘dkoÄąâ€şci kĂ„â€¦towe bryÄąâ€šy wokÄ‚Ĺ‚Äąâ€š wÄąâ€šasnych osi. RÄ‚Ĺ‚ÄąÄ˝nica pojawia siĂ„â„˘
      // dopiero przy duÄąÄ˝ych, jednoczesnych pitch+roll (poza normalnym zakresem
      // lotu liniowego A321) Ă˘â‚¬â€ť peÄąâ€šne rÄ‚Ĺ‚wnania kinematyczne Eulera (z sin/cos/tan
      // kĂ„â€¦tÄ‚Ĺ‚w i ryzykiem "gimbal lock" przy pitch=90Ă‚Â°) to moÄąÄ˝liwe, ale odrĂ„â„˘bne,
      // wiĂ„â„˘ksze rozszerzenie, ktÄ‚Ĺ‚rego ten samolot w normalnej eksploatacji nie
      // potrzebuje.
      this.pitchRad += this.pitchRate * dtCap;
      this.rollRad  += this.rollRate  * dtCap;
      this.yawRad   += this.yawRate   * dtCap;
      // NAPRAWA: przy trafieniu na limit zerujemy TEÄąÂ» prĂ„â„˘dkoÄąâ€şĂ„â€ˇ kĂ„â€¦towĂ„â€¦ (jeÄąâ€şli
      // dalej "pcha" w tĂ„â„˘ samĂ„â€¦ stronĂ„â„˘) Ă˘â‚¬â€ť inaczej samolot byÄąâ€š "przyklejony" do
      // Äąâ€şciany limitu z rosnĂ„â€¦cym, niewidocznym "napiĂ„â„˘ciem" (rate dalej rosÄąâ€šo),
      // ktÄ‚Ĺ‚re potem gwaÄąâ€štownie siĂ„â„˘ rozladowywaÄąâ€šo przy odblokowaniu.
      if (this.rollRad > 1.40) { this.rollRad = 1.40; if (this.rollRate > 0) this.rollRate = 0; }
      if (this.rollRad < -1.40) { this.rollRad = -1.40; if (this.rollRate < 0) this.rollRate = 0; }
      // MiĂ„â„˘kkie zabezpieczenie przed skrajnoÄąâ€şciami (np. bÄąâ€šĂ„â€¦d w innej czĂ„â„˘Äąâ€şci
      // kodu, albo naprawdĂ„â„˘ ekstremalny manewr) Ă˘â‚¬â€ť to NIE jest "tail-strike cap"
      // sterujĂ„â€¦cy normalnym zachowaniem: samo unikanie tail-strike wynika teraz
      // z fizyki podwozia (moment z gear force), nie z tego limitu. Na ziemi
      // zaciÄąâ€şniĂ„â„˘ty bardziej (margines bezpieczeÄąâ€žstwa), w locie znacznie luÄąĹźniej.
      const pitchClampMax = this.onGround ? 0.35 : 0.75;
      if (this.pitchRad > pitchClampMax) { this.pitchRad = pitchClampMax; if (this.pitchRate > 0) this.pitchRate = 0; }
      if (this.pitchRad < -0.45) { this.pitchRad = -0.45; if (this.pitchRate < 0) this.pitchRate = 0; }

      // Attitude hold: TYLKO gdy pilot nie trzyma wyraÄąĹźnego inputu pitch,
      // regulator PD aktywnie utrzymuje this.pitchHoldTarget (patrz NAPRAWA v3
      // przy PITCH_HOLD_KP/KD) Ă˘â‚¬â€ť zamiast tylko zerowaĂ„â€ˇ pitchRate (co dryfowaÄąâ€šo
      // do jednego, naturalnego kĂ„â€¦ta zaleÄąÄ˝nego od throttle/klap), teraz trzyma
      // DOKÄąÂADNIE ten kĂ„â€¦t, w ktÄ‚Ĺ‚rym pilot zostawiÄąâ€š samolot. Gdy pilot trzyma
      // input, target na bieÄąÄ˝Ă„â€¦co podĂ„â€¦ÄąÄ˝a za aktualnym pitchem, ÄąÄ˝eby "zÄąâ€šapaĂ„â€ˇ"
      // wÄąâ€šaÄąâ€şciwy kĂ„â€¦t w chwili puszczenia drĂ„â€¦ÄąÄ˝ka.
      // Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬ Autopilot: oÄąâ€ş pochylenia (ALT HOLD / V-S HOLD) Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬
      // Kaskada: bÄąâ€šĂ„â€¦d wysokoÄąâ€şci (ALT) -> cel V/S -> (integrator) -> cel pitch
      // -> ISTNIEJĂ„â€žCY regulator PD niÄąÄ˝ej (pitchHoldTarget/PITCH_HOLD_KP/KD).
      // Liczone TYLKO gdy pilot faktycznie nie trzyma steru (identyczny prÄ‚Ĺ‚g
      // co reszta hold-logiki) Ă˘â‚¬â€ť inaczej walczylibyÄąâ€şmy z rĂ„â„˘cznym wejÄąâ€şciem.
      if (this.ap.master && (this.ap.altHold || this.ap.vsHold) && Math.abs(pitchInput) < AP_MANUAL_OVERRIDE_DEADZONE) {
        const vsTargetMs = this.ap.altHold
          ? Math.max(-AP_MAX_VS_MS, Math.min(AP_MAX_VS_MS, (Units.ftToM(this.ap.targetAltFt) - this.altM) * AP_ALT_KP))
          : Units.fpmToMs(this.ap.targetVsFpm);
        const vsErrMs = vsTargetMs - this.vel.y; // this.vel.y = V/S wzglĂ„â„˘dem ziemi, patrz this.vs niÄąÄ˝ej Ă˘â‚¬â€ť to jest to co ma pokazywaĂ„â€ˇ AP
        this.pitchHoldTarget += AP_VS_TO_PITCH_KI * vsErrMs * dtCap;
        this.pitchHoldTarget = Math.max(-AP_MAX_PITCH_RAD, Math.min(AP_MAX_PITCH_RAD, this.pitchHoldTarget));
      }

      // Attitude hold: TYLKO gdy pilot nie trzyma wyraÄąĹźnego inputu pitch,
      // regulator PD aktywnie utrzymuje this.pitchHoldTarget (patrz NAPRAWA v3
      // przy PITCH_HOLD_KP/KD) Ă˘â‚¬â€ť zamiast tylko zerowaĂ„â€ˇ pitchRate (co dryfowaÄąâ€šo
      // do jednego, naturalnego kĂ„â€¦ta zaleÄąÄ˝nego od throttle/klap), teraz trzyma
      // DOKÄąÂADNIE ten kĂ„â€¦t, w ktÄ‚Ĺ‚rym pilot zostawiÄąâ€š samolot. Gdy pilot trzyma
      // input, target na bieÄąÄ˝Ă„â€¦co podĂ„â€¦ÄąÄ˝a za aktualnym pitchem, ÄąÄ˝eby "zÄąâ€šapaĂ„â€ˇ"
      // wÄąâ€šaÄąâ€şciwy kĂ„â€¦t w chwili puszczenia drĂ„â€¦ÄąÄ˝ka. PowyÄąÄ˝sza kaskada AP tylko
      // PRZESUWA pitchHoldTarget zanim tu dojdziemy Ă˘â‚¬â€ť sam regulator PD jest
      // wspÄ‚Ĺ‚lny dla rĂ„â„˘cznego auto-trymu i dla autopilota.
      if (Math.abs(pitchInput) < 0.05) {
        const pitchErr = this.pitchRad - this.pitchHoldTarget; // dodatnie = pitch za wysoko wzglĂ„â„˘dem celu
        this.pitchTrim += (PITCH_HOLD_KP * pitchErr + PITCH_HOLD_KD * this.pitchRate) * dtCap;
        this.pitchTrim = Math.max(-ELEVATOR_MAX_RAD, Math.min(ELEVATOR_MAX_RAD, this.pitchTrim));
      } else {
        this.pitchHoldTarget = this.pitchRad;
        // RĂ„â„˘czne przejĂ„â„˘cie steru rozÄąâ€šĂ„â€¦cza autopilota na osi pitch (jak w
        // realu Ă˘â‚¬â€ť sidestick z siÄąâ€šĂ„â€¦ powyÄąÄ˝ej progu odÄąâ€šĂ„â€¦cza A/P).
        if (this.ap.master) { this.ap.altHold = false; this.ap.vsHold = false; }
      }

      const eastVel  = this.vel.x;
      const northVel = -this.vel.z;
      const cosLat = Math.cos(Units.degToRad(this.lat));
      this.lat  += (northVel / EARTH_RADIUS) * (180 / Math.PI) * dtCap;
      this.lon  += (eastVel  / (EARTH_RADIUS * cosLat)) * (180 / Math.PI) * dtCap;
      this.altM += this.vel.y * dtCap;
    }

    // NAPRAWA (wiatr): VMO jest limitem prĂ„â„˘dkoÄąâ€şci WZGLĂ„ÂDEM POWIETRZA (to on
    // wyznacza rzeczywiste obciĂ„â€¦ÄąÄ˝enie aerodynamiczne/strukturalne), nie
    // wzglĂ„â„˘dem ziemi. Bez tej poprawki silny tailwind faÄąâ€šszywie "Äąâ€šamaÄąâ€šby"
    // limit (a samolot byÄąâ€šby bezpieczny aerodynamicznie), a silny headwind
    // mÄ‚Ĺ‚gÄąâ€šby ukryĂ„â€ˇ realne przekroczenie VMO. Przycinamy wiĂ„â„˘c skÄąâ€šadowĂ„â€¦
    // wzglĂ„â„˘dem powietrza, zachowujĂ„â€¦c kierunek wiatru w wyniku.
    let _preClampOverVmo = false;
    {
      const airRelNow = this.vel.clone().sub(this.windVec3);
      if (airRelNow.length() > A321_PARAMS.VMO) {
        _preClampOverVmo = true;
        airRelNow.setLength(A321_PARAMS.VMO);
        this.vel.copy(airRelNow.add(this.windVec3));
      }
    }

    // Ă˘â€ťâ‚¬Ă˘â€ťâ‚¬ Stan po integracji: Äąâ€şwieÄąÄ˝a prÄ‚Ĺ‚bka podwozia z NOWEJ pozycji Ă˘â‚¬â€ť do tego
    // sÄąâ€šuÄąÄ˝y onGround/agl/markery, i zabezpieczenie awaryjne przed "zamurowaniem"
    // pod terenem w jednej klatce (duÄąÄ˝a prĂ„â„˘dkoÄąâ€şĂ„â€ˇ Ä‚â€” duÄąÄ˝y dtCap, spawn, teleport). Ă˘â€ťâ‚¬
    let gearFinal = gear;
    if (this.gearDown && (this.onGround || this._nearGroundZone || bounced)) {
      gearFinal = this.sampleGear(noseDir, wingRight, acUp);
      const maxPen = Math.max(gearFinal.nose.pen, gearFinal.left.pen, gearFinal.right.pen);
      if (maxPen > GEAR_EMERGENCY_PEN_M) {
        // Zabezpieczenie awaryjne Ă˘â‚¬â€ť NIE normalny mechanizm gry, tylko siatka
        // bezpieczeÄąâ€žstwa przed utkniĂ„â„˘ciem pod mapĂ„â€¦.
        const push = 1 - Math.exp(-dtCap / GEAR_EMERGENCY_SETTLE_TAU);
        this.altM += maxPen * push;
        if (this.vel.y < 0) this.vel.y *= (1 - push);
        if (window.DEBUG_GEAR) {
          console.error(`[GEAR DEBUG] AWARYJNE zanurzenie w ziemiĂ„â„˘! maxPen=${maxPen.toFixed(2)}m lat=${this.lat.toFixed(6)} lon=${this.lon.toFixed(6)} altM=${this.altM.toFixed(1)}`);
        }
      }
      this.onGround = maxPen >= 0 && !bounced;
    } else {
      this.onGround = false;
    }

    this.airspeed = this.vel.clone().sub(this.windVec3).length();

    // OVERSPEED z histereza: predkosc jest twardo przycinana do VMO powyzej
    // (patrz NAPRAWA wiatr), wiec surowe "this.airspeed > VMO" migotaloby
    // klatka po klatce dokladnie na granicy odciecia (stad w praktyce
    // ostrzezenie overspeed prawie nigdy sie nie wlaczalo albo migalo).
    // Wlacz gdy faktycznie probowalismy przekroczyc limit w tej klatce
    // (przed przycieciem) LUB swieza wartosc i tak jest powyzej VMO; wylacz
    // dopiero po zejsciu WYRAZNIE ponizej (margines histerezy).
    const VMO_OFF_MARGIN_MPS = 1.0; // ok. 2 kt marginesu histerezy
    if (_preClampOverVmo || this.airspeed > A321_PARAMS.VMO) {
      this._isOverspeed = true;
    } else if (this.airspeed < A321_PARAMS.VMO - VMO_OFF_MARGIN_MPS) {
      this._isOverspeed = false;
    }
    // w strefie histerezy (miedzy VMO-margines a VMO) zachowujemy poprzedni stan
    this.groundSpeed = this.vel.length(); // do HUD/debug Ă˘â‚¬â€ť wyraÄąĹźnie odrÄ‚Ĺ‚ÄąÄ˝nione od airspeed teraz, gdy jest wiatr
    this.terrainM = groundH;
    this.agl = gearFinal
      ? Math.max(0, -Math.max(gearFinal.nose.pen, gearFinal.left.pen, gearFinal.right.pen))
      : Math.max(0, this.altM - groundH - gearOffset);
    this.vs = this.vel.y;
    this._alpha = alpha; this._cl = cl; this._isStalling = isStalling;
    this.heading = this.headingDeg;
    this.pitch = this.pitchRad * 180 / Math.PI;
    this.roll  = this.rollRad  * 180 / Math.PI;
    this._noseDir = noseDir; this._wingRight = wingRight; this._acUp = acUp;

    // DEBUG: prosty log co DEBUG_HEARTBEAT_SEC sekund, format klucz=wartoÄąâ€şĂ„â€ˇ w
    // jednej linii Ă˘â‚¬â€ť wystarczy skopiowaĂ„â€ˇ kilka linii z konsoli przy zgÄąâ€šaszaniu
    // problemÄ‚Ĺ‚w z pitch/trymem/attitude-hold. WyÄąâ€šĂ„â€¦czane przez window.DEBUG_PITCH = false.
    if (window.DEBUG_PITCH) {
      this._debugHeartbeat = (this._debugHeartbeat || 0) + dtCap;
      if (this._debugHeartbeat >= DEBUG_HEARTBEAT_SEC) {
        this._debugHeartbeat = 0;
        this._debugElapsed = (this._debugElapsed || 0) + DEBUG_HEARTBEAT_SEC;
        console.log(
          `t=${this._debugElapsed.toFixed(0)} pitch=${(this.pitchRad * 180 / Math.PI).toFixed(1)} ` +
          `rate=${(this.pitchRate * 180 / Math.PI).toFixed(1)} alpha=${(alpha * 180 / Math.PI).toFixed(1)} ` +
          `input=${pitchInput.toFixed(2)} trim=${(this.pitchTrim * 180 / Math.PI).toFixed(2)} ` +
          `target=${(this.pitchHoldTarget * 180 / Math.PI).toFixed(1)} flaps=${flap} ` +
          `V=${speedKt.toFixed(0)}kt vs=${this.vel.y.toFixed(1)} gnd=${this.onGround ? 1 : 0} stall=${isStalling ? 1 : 0} ` +
          `wind=${this.windDirDeg.toFixed(0)}/${this.windSpeedKt.toFixed(0)}kt gs=${groundSpeedKt.toFixed(0)}kt ` +
          `ap=${this.ap.master ? (this.ap.hdgHold?'H':'') + (this.ap.altHold?'A':'') + (this.ap.vsHold?'V':'') + (this.ap.spdHold?'S':'') || 'ON' : 'OFF'}`
        );
      }
    }

    this._updateGearMarkers(gearFinal);
  }

  // Aktualizuje pozycjĂ„â„˘/widocznoÄąâ€şĂ„â€ˇ/kolor 3 kulek-markerÄ‚Ĺ‚w kolizji podwozia
  // (patrz GEAR_MARKER_*): widoczne TYLKO gdy sampleGear() faktycznie zostaÄąâ€šo
  // policzone w tej klatce (this._nearGroundZone lub onGround Ă˘â‚¬â€ť patrz gear
  // wyÄąÄ˝ej w physicsUpdate), bo tylko wtedy znamy ich rzeczywistĂ„â€¦ pozycjĂ„â„˘.
  // PeÄąâ€šna jasnoÄąâ€şĂ„â€ˇ = koÄąâ€šo aktualnie dotyka/koliduje z terenem (pen >= 0),
  // przygaszona = w pobliÄąÄ˝u ziemi ale jeszcze w powietrzu Ă˘â‚¬â€ť daje wizualny
  // podglĂ„â€¦d dokÄąâ€šadnie tych samych 3 punktÄ‚Ĺ‚w, ktÄ‚Ĺ‚rych uÄąÄ˝ywa silnik fizyki.
  _updateGearMarkers(gear) {
    if (!gear) {
      for (const k of ['nose', 'left', 'right']) this._gearMarkers[k].visible = false;
      return;
    }
    for (const k of ['nose', 'left', 'right']) {
      const g = gear[k];
      const marker = this._gearMarkers[k];
      marker.visible = true;
      // Pozycja w Äąâ€şwiecie: ten sam punkt geo co uÄąÄ˝yty w sampleGearPoint(), na
      // wysokoÄąâ€şci terenu w tym miejscu (a nie na wysokoÄąâ€şci koÄąâ€ša) Ă˘â‚¬â€ť tak marker
      // zawsze "leÄąÄ˝y" na ziemi, dobrze pokazujĂ„â€¦c gdzie fizyka sprawdza kontakt.
      const { lat: glat, lon: glon } = offsetGeo(this.lat, this.lon, g.offset.x, -g.offset.z);
      marker.position.copy(geoToWorld(glat, glon, g.groundH * DEM_EXAG));
      const touching = g.pen >= 0;
      marker.material.opacity = touching ? 0.85 : 0.25;
      marker.scale.setScalar(touching ? 1.4 : 1.0);
    }
  }

  renderUpdate(frameDt) {
    this.fanAngle += this.throttle * frameDt * 30;
    const p = this._parts;
    if (p.fanR) p.fanR.rotation.x = this.fanAngle;
    if (p.fanL) p.fanL.rotation.x = this.fanAngle;
    
    if (this.gearDown && this.onGround) {
      const horizSpeed = Math.sqrt(this.vel.x ** 2 + this.vel.z ** 2);
      const wheelRadius = 0.5;
      this.gearAngle += (horizSpeed * frameDt) / wheelRadius;
    }
    if (p.gearFL) p.gearFL.rotation.z = this.gearAngle;
    if (p.gearBL) p.gearBL.rotation.z = this.gearAngle;
    if (p.gearBR) p.gearBR.rotation.z = this.gearAngle;

    this.beaconTimer += frameDt;
    if (p.beacon) p.beacon.visible = Math.sin(this.beaconTimer * 6) > 0;
    const flapTarget = this.flaps * 12 * Math.PI / 180;
    this.prevFlapPos += (flapTarget - this.prevFlapPos) * Math.min(1, frameDt * 4);
    if (p.flapR) p.flapR.rotation.x = this.prevFlapPos;
    if (p.flapL) p.flapL.rotation.x = this.prevFlapPos;
    const spoilerTarget = this.spoilers ? 35 * Math.PI / 180 : 0;
    if (p.spoilerR) p.spoilerR.rotation.x = -spoilerTarget;
    if (p.spoilerL) p.spoilerL.rotation.x = -spoilerTarget;
    
    // Ster wysokoÄąâ€şci zaleÄąÄ˝y bezpoÄąâ€şrednio od wychylenia wolantu (inputu),
    // a nie od wynikowego obrotu samolotu. Max ok 25 stopni (0.43 radiana).
    const elevTarget = (typeof planeInput !== 'undefined' ? planeInput.pitch : 0) * 0.43;
    this.elevPos += (elevTarget - this.elevPos) * Math.min(1, frameDt * 10); // LERP dla pÄąâ€šynnego ruchu hydrauliki
    
    if (p.elevatorR && p.elevatorR.userData.hingeAxis) p.elevatorR.quaternion.setFromAxisAngle(p.elevatorR.userData.hingeAxis, this.elevPos);
    if (p.elevatorL && p.elevatorL.userData.hingeAxis) p.elevatorL.quaternion.setFromAxisAngle(p.elevatorL.userData.hingeAxis, this.elevPos);

    // NAPRAWA (zgÄąâ€šoszone: "rudder obraca siĂ„â„˘ sam"): poprzednio wizualny obrÄ‚Ĺ‚t
    // steru kierunku byÄąâ€š ustawiany na podstawie this.yawRate Ă˘â‚¬â€ť czyli
    // WYNIKOWEJ prĂ„â„˘dkoÄąâ€şci kĂ„â€¦towej odchylenia CAÄąÂEGO samolotu, nie wychylenia
    // pedaÄąâ€šÄ‚Ĺ‚w pilota. Teraz gdy yaw jest napĂ„â„˘dzany prawdziwĂ„â€¦ fizykĂ„â€¦
    // (statecznoÄąâ€şĂ„â€ˇ kierunkowa, reakcje podwozia), samolot ma naturalne,
    // niewielkie korekty yaw nawet gdy pilot nic nie robi Ă˘â‚¬â€ť i ster kierunku
    // "sam" siĂ„â„˘ poruszaÄąâ€š w ich takt. Tak jak elevator wyÄąÄ˝ej: ster wizualnie
    // reaguje na WYCHYLENIE PEDAÄąÂÄ‚â€śW (inputu), nie na wynik ruchu samolotu.
    const rudderTarget = (typeof planeInput !== 'undefined' ? planeInput.yaw : 0) * RUDDER_MAX_RAD;
    this.rudderPos += (rudderTarget - this.rudderPos) * Math.min(1, frameDt * 10);
    if (p.rudder && p.rudder.userData.hingeAxis) {
      p.rudder.quaternion.setFromAxisAngle(p.rudder.userData.hingeAxis, this.rudderPos);
    } else if (p.rudder) {
      p.rudder.rotation.y = this.rudderPos;
    }

  }

  // (nie jednej figury sztywno przeskalowanej) Ă˘â‚¬â€ť obraca obrys peÄąâ€šnĂ„â€¦ orientacjĂ„â€¦
  // samolotu, przesuwa do jego pozycji w Äąâ€şwiecie, a potem rzutuje kaÄąÄ˝dy punkt
  // na teren WZDÄąÂUÄąÂ» kierunku promieni sÄąâ€šonecznych (z doprecyzowaniem wysokoÄąâ€şci
  // terenu w miejscu trafienia w kilku iteracjach, bo teren pod cieniem nie musi
  // byĂ„â€ˇ pÄąâ€šaski Ă˘â‚¬â€ť np. na zboczu albo przy krawĂ„â„˘dzi pasa). Bez SÄąâ€šoÄąâ€žca nad
  // horyzontem (noc) cieÄąâ€ž jest po prostu ukryty.
}


