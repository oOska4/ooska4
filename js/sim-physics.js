'use strict';

// ── Ładowanie modelu A321 z a321.obj + a321.mtl ───────────────────────────────
// (a321.mtl wskazuje tekstury w folderze objwmtl/ — ścieżki względne, nie
// trzeba ich tu powtarzać; wystarczy wczytać .mtl, a potem .obj z tymi materiałami)

const A321_OBJ_URL = './a321.obj';
const A321_MTL_URL = './a321.mtl';

// Jeśli po wczytaniu samolot będzie odwrócony nosem w złą stronę albo źle przechylony,
// zmień tę wartość (np. Math.PI/2, -Math.PI/2, Math.PI) aż dziób wskaże w +Z w lokalnym układzie.
const A321_MODEL_ROT_Y = Math.PI / 2;
// Jeśli samolot będzie zbyt duży/mały względem terenu, zmień skalę (np. 0.01 jeśli model jest w cm).
const A321_MODEL_SCALE = 0.25;
// Jeśli samolot będzie przesunięty w górę/dół względem terenu, zmień przesunięcie (np. 0.01 jeśli model jest w cm).
const A321_MODEL_TRANSLATE_Y = -4.5;

// Obiekty w a321.obj o nazwie zaczynającej się od tego prefiksu (gears_back_tires,
// gears_covers, gears_front_tire, gears_holder_*) trafiają do wspólnej grupy
// "gearGroup", tak jak wcześniej, gdy każdy z nich był osobnym plikiem .obj —
// dzięki temu chowanie/pokazywanie podwozia (updateGearVisibility) działa bez zmian.
const A321_GEAR_PREFIX = 'gears_';

function _explainModelLoadError(url, err) {
  if (location.protocol === 'file:') {
    console.error(`[A321] Nie można wczytać "${url}" z pliku lokalnego. Uruchom stronę przez lokalny serwer HTTP, np. python -m http.server 8000.`);
  }
  const cause = err && err.message ? err.message : err;
  return new Error(`[A321] Błąd ładowania ${url}: ${cause}`);
}

async function loadA321Model() {
  // 1) Wczytaj definicje materiałów z .mtl (tekstury objwmtl/*.png są w nim
  //    zapisane ścieżkami względnymi do lokalizacji samego .mtl).
  const materials = await new Promise((resolve, reject) => {
    new THREE.MTLLoader().load(A321_MTL_URL, resolve, undefined,
      err => reject(_explainModelLoadError(A321_MTL_URL, err)));
  });
  materials.preload();

  // Mapa "nazwa części" → gotowy materiał z tą częścią powiązany, wyprowadzona
  // bezpośrednio z wpisów map_Kd w .mtl (np. "objwmtl/cockpit_inside.png" →
  // część "cockpit_inside"). Używamy jej jako niezawodnego planu B: nazwa
  // części w a321.obj ("o cockpit_inside") jest zawsze taka sama jak nazwa
  // pliku tekstury, więc to działa niezależnie od tego, czy wewnętrzne
  // dopasowanie usemtl↔newmtl w OBJLoaderze się powiedzie.
  const partNameToMaterial = {};
  for (const matName in materials.materialsInfo) {
    const mapKd = materials.materialsInfo[matName] && materials.materialsInfo[matName].map_kd;
    if (!mapKd) continue;
    const partName = mapKd.split('/').pop().replace(/\.[a-zA-Z0-9]+$/, '');
    partNameToMaterial[partName] = materials.create(matName);
  }

  // 2) Wczytaj geometrię .obj z już przygotowanymi materiałami z .mtl —
  //    OBJLoader sam dopasuje materiał do każdej części wg "usemtl" w pliku.
  const group = await new Promise((resolve, reject) => {
    new THREE.OBJLoader()
      .setMaterials(materials)
      .load(A321_OBJ_URL, resolve, undefined,
        err => reject(_explainModelLoadError(A321_OBJ_URL, err)));
  });

  // 3) Tak jak wcześniej: dwustronne renderowanie, poprawny color space tekstur,
  //    anizotropia — i wydzielenie podwozia do osobnej grupy. Plus zabezpieczenie:
  //    jeśli część nie ma tekstury (mapa się nie dopasowała), wymuszamy ją po
  //    nazwie części z mapy zbudowanej wyżej.
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
        console.warn(`[A321] "${child.name}" nie dostał tekstury z OBJLoadera — wymuszono materiał po nazwie części.`);
      }
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      for (const mat of mats) {
        if (!mat) continue;
        mat.side = THREE.DoubleSide;
        if (mat.map) {
          mat.map.encoding   = THREE.sRGBEncoding;
          mat.map.anisotropy = maxAniso;
        }
        // Dodatkowy stały "fill" (+20,20,20 w skali 0-255) niezależny od
        // oświetlenia sceny — samolot inaczej gubił się w cieniu własnym,
        // gęstej mgle albo nocą, gdy sunLight/hemiLight są słabe. emissive
        // dodaje stałą jasność niezależnie od padającego światła.
        if (mat.emissive) mat.emissive.addScalar(20 / 255);
      }
    });
    if (child.name.startsWith(A321_GEAR_PREFIX)) gearGroup.add(child); // .add() sam usuwa z poprzedniego rodzica
  }

  if (gearGroup.children.length) group.add(gearGroup);
  return group;
}

// ── Parametry fizyki A321 ──────────────────────────────────────────────────────

const G_ACC = 9.81;
const RHO   = 1.225;

// Reverse thrust: ok. 20% maksymalnego ciągu do przodu — typowe dla
// wysokoprzepływowych silników turbowentylatorowych (reverser "łapie" tylko
// strumień obejściowy, nie cały ciąg silnika). Patrz reverserDeployFrac w
// physicsUpdate() — ciąg wsteczny narasta wraz z fizycznym wysuwaniem
// rewersorów, nie skokowo.
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
  // NAPRAWA (zgłoszone: "przy flaps=1 ciągły dryf pitch w górę, kończący się
  // głębokim przeciągnięciem"): flapCl[1]=0.70 dawało przy wypuszczeniu klap
  // (flaps 0->1 w locie, przy niezmienionym alpha) nagły skok siły nośnej
  // ~525 000 N (prawie 70% ciężaru samolotu!) — auto-trim (PITCH_TRIM_RATE)
  // jest za wolny, żeby to skompensować, więc samolot wpada w niedotłumiony
  // phugoid i przy tak dużym zaburzeniu ucieka w powtarzające się głębokie
  // przeciągnięcia. 0.70 było też fizycznie nierealistyczne dla flaps=1
  // (to najmniejsze ustawienie, odpowiednik samych slatów/małego wychylenia —
  // powinno dawać dużo mniejszy przyrost CL niż flaps=2/3). Zweryfikowano
  // symulacyjnie (Node+three.js, replika physicsUpdate): próg niestabilności
  // jest przy flapCl[1]≈0.30; 0.25 ma margines i nie wchodzi w przeciągnięcie
  // ani przy wypuszczeniu, ani przy schowaniu klap w locie. flapCl[2]/[3] NIE
  // zmienione — nie zgłoszono tam problemu, ale ten sam mechanizm (duży,
  // nagły skok CL) może teoretycznie dotyczyć i tamtych przejść, jeśli kiedyś
  // się ujawni.
  flapCl:     [0.0, 0.25, 1.20, 1.80],
  flapCd:     [0.0, 0.040, 0.085, 0.160],
  flapStall:  [0.285, 0.32, 0.36, 0.40],
  cdGear:     0.060,
  groundRunThrustBoost: 2.20,
  groundRunDragScale:   0.30,
  // NAPRAWA: poprzednio 0.80 sztucznie ODEJMOWAŁO 20% siły nośnej blisko
  // ziemi — w rzeczywistości efekt przyziemny (ground effect) siłę nośną
  // raczej lekko ZWIĘKSZA (redukcję oporu indukowanego blisko ziemi i tak już
  // modeluje osobno groundEffectFactor()/cdi niżej). Ta kara powodowała, że
  // samolot fizycznie nie mógł wygenerować dość siły nośnej do oderwania w
  // pobliżu zamierzonego Vr — musiał jechać dużo szybciej niż powinien,
  // cały czas "przyklejony" do limitu pitch (patrz GEAR_TAILSTRIKE_PITCH_LIMIT).
  groundRunLiftScale:   1.0,
  spoilerCd:  0.30,
  spoilerLiftLoss: 0.35,
  V1: 69.4, VR: 74.7, V2: 79.8, Vstall: 62, VMO: 189,
};

// ── Geometria i zawieszenie podwozia ───────────────────────────────────────────
//
// Współrzędne 3 punktów styczności kół z ziemią w LOKALNYM układzie samolotu
// (ten sam co reszta fizyki: +X = prawe skrzydło,
// +Y = góra, +Z = dziób), w metrach względem "origin" encji (this.altM/lat/lon).
// Wyznaczone bezpośrednio z geometrii a321.obj (dolne punkty opon), a nie
// zgadnięte — dzięki temu naturalny kąt spoczynkowy samolotu na 3 kołach
// wynika z samego modelu, a nie ze stałej "gearOffset" jak wcześniej.
const GEAR_NOSE  = { x: -0.17, y: -3.53, z: 15.34 };
const GEAR_LEFT  = { x: -3.96, y: -3.75, z: -1.20 };
const GEAR_RIGHT = { x:  3.62, y: -3.75, z: -1.20 };
// Przybliżona wysokość "spoczynkowa" origin encji nad terenem, gdy podwozie
// stoi na płaskiej ziemi — używana tylko jako sensowna wysokość startowa w
// reset() (dokładny kąt/wysokość i tak dociąga się w pierwszej klatce fizyki).
const GEAR_MAIN_REST_OFFSET = -GEAR_LEFT.y;

// Zawieszenie (amortyzacja goleni) — na razie WYŁĄCZNIE fizyczne (wpływa na
// wysokość kadłuba), bez animacji ugięcia samej goleni/opony (to osobny,
// wizualny krok na później). Każda goleń ma własny, niezależny stan "wgniecenia".
const GEAR_SUSPENSION_TRAVEL   = 0.42; // maks. całkowite wgniecenie w ziemię (m) — od tego miejsca dochodzi dodatkowa sztywność "twardego zderzaka" (patrz GEAR_HARDSTOP_K_MULT)

// ZMIANA ARCHITEKTURY: zawieszenie już NIE ma własnego, osobnego stanu
// "wgniecenia" (dawne this.gearSink/gearSinkVel) — to była animacja BLENDOWANA
// do wyniku, a nie prawdziwa siła. Teraz ugięcie to po prostu GEOMETRYCZNA
// głębokość penetracji terenu przez faktyczną, aktualną pozycję/orientację
// samolotu (pen z sampleGear()), a siła sprężysto-tłumiąca liczona z niej
// WPROST (F = k·pen + c·prędkość_zagłębiania, patrz physicsUpdate) trafia do
// sumy sił/momentów całej bryły sztywnej — tak jak w prawdziwym zawieszeniu:
// to sama sprężyna, poprzez swoją siłę, decyduje jak samolot się zachowuje, a
// nie osobna symulacja "na boku", której wynik potem doklejamy do pitch/roll.
const GEAR_SUSP_OMEGA_MAIN     = 12.57; // rad/s — częstość własna zawieszenia głównego (~0.5s okresu, nietłumiony)
const GEAR_SUSP_ZETA_MAIN      = 0.85;  // współczynnik tłumienia głównego (0.85 = mocno tłumiony, bez widocznego odbicia)
const GEAR_SUSP_OMEGA_NOSE     = 15.0;  // rad/s — przednie koło nieco sztywniejsze/szybsze
const GEAR_SUSP_ZETA_NOSE      = 0.9;
// ── Bryła sztywna: masa, momenty bezwładności, geometria aerodynamiczna ────────
//
// KOMPLETNY REMAKE fizyki ziemia/rotacja/pitch: zamiast oddzielnych "sztucznych"
// krzywych (elevatorAuthority, timer oderwania, blendowanie kąta do terenu,
// zaciskający się limit pitch) samolot jest teraz PRAWDZIWĄ bryłą sztywną —
// każda siła (skrzydło, usterzenie/ster wysokości, statecznik/ster kierunku,
// ciąg, 3 punkty podwozia) jest przyłożona w swoim RZECZYWISTYM miejscu
// względem środka masy (CG), co razem z ramieniem daje moment (τ = r×F). Suma
// momentów / moment bezwładności = przyspieszenie kątowe (patrz physicsUpdate)
// — samolot podrywa nos, bo ster wysokości FIZYCZNIE go podrywa, i odrywa się
// od ziemi, bo siły w pionie FIZYCZNIE to robią, a nie bo jakiś timer/próg tak
// zdecydował.
//
// Dokładne certyfikowane momenty bezwładności nie są publicznie dostępne —
// liczymy je standardową metodą inżynierską "promienia żyracji" (radius of
// gyration): I = masa × r_żyr², gdzie r_żyr to ułamek charakterystycznego
// wymiaru samolotu (kadłub dla pitch/yaw, rozpiętość dla roll). To
// przybliżenie, ale oparte na prawdziwej geometrii A321, nie na zgadywaniu.
const A321_FUSELAGE_LEN = 44.5; // m
// UWAGA: było `const` — teraz `let`, bo masa (a więc i bezwładność) może się
// zmienić po Reset z nowym paliwem/payloadem (patrz recomputeInertia() i
// applyAircraftWeight() dalej w tym pliku). Wzór bez zmian.
let A321_IYY = A321_PARAMS.mass * (0.25 * A321_FUSELAGE_LEN) ** 2; // pitch, ok. 9.3M kg·m²
let A321_IXX = A321_PARAMS.mass * (0.23 * A321_PARAMS.span) ** 2;  // roll,  ok. 5.1M kg·m²
let A321_IZZ = A321_PARAMS.mass * (0.27 * A321_FUSELAGE_LEN) ** 2; // yaw,   ok. 12.2M kg·m² (obejmuje i długość, i rozstaw mas)

// Gdzie faktycznie działają siły aerodynamiczne, w LOKALNYM układzie samolotu
// (ten sam co GEAR_NOSE/LEFT/RIGHT: +X prawe skrzydło, +Y góra, +Z dziób). To
// jest sedno "prawdziwej fizyki": ster wysokości nie "ustawia pitchRate"
// bezpośrednio — wytwarza siłę W TYM miejscu, daleko za CG, i to WŁAŚNIE
// ramię (TAIL_AC.z) zamienia tę siłę w moment obracający cały samolot.
const WING_AC   = { x: 0, y: 0,   z: 0.4   }; // środek parcia skrzydła — bardzo blisko CG (było 1.2m — patrz NAPRAWA przy THRUST_PT, ten sam powod: zbyt duży moment pitch-up przy typowej sile nośnej ≈ciężarowi)
const TAIL_AC   = { x: 0, y: 0.4, z: -17.5 }; // usterzenie poziome + ster wysokości — daleko za CG
const FIN_AC    = { x: 0, y: 2.2, z: -17.0 }; // statecznik pionowy + ster kierunku — za CG, podniesiony (stąd sprzężenie z rollem)
// NAPRAWA (zgłoszone: "samolot stale przechyla się do tyłu"): silnik pod CG
// (THRUST_PT.y<0) daje moment pitch-up proporcjonalny do ciągu — realny
// efekt ("power pitch coupling"), ale ramię 1.6m w połączeniu z 2.2× mnożnikiem
// ciągu na ziemi (groundRunThrustBoost — czysto growplayowe wzmocnienie
// przyspieszenia, NIE prawdziwy wzrost mocy silników) dawało moment zbliżający
// się do granicy, jaką mogło skompensować przednie koło — przy większej
// przepustnicy nos unosił się SAM, bez udziału pilota. Ramię zmniejszone, a
// moment liczony teraz z NIEPODBITEGO ciągu (patrz physicsUpdate) — realne
// "power pitch" zostaje, ale nie przytłacza już geometrii podwozia.
const THRUST_PT = { x: 0, y: -0.4, z: 0    }; // silniki pod skrzydłami — poniżej CG (ramię zmniejszone z -1.6, patrz NAPRAWA wyżej)

// Bazowe (fabryczne, przy DOMYŚLNYM załadowaniu — patrz A321_DEFAULT_FUEL_KG/
// A321_DEFAULT_PAYLOAD_KG niżej) pozycje Z powyższych punktów, zanim CG się
// przesunie. applyAircraftWeight() mutuje WING_AC.z/TAIL_AC.z/FIN_AC.z/
// THRUST_PT.z WZGLĘDEM tych baz — same obiekty zostają te same (przez
// referencję), więc każde miejsce w pliku, które czyta np. TAIL_AC.z, widzi
// automatycznie aktualną, przesuniętą wartość bez żadnych dodatkowych zmian.
const WING_AC_BASE_Z   = WING_AC.z;
const TAIL_AC_BASE_Z   = TAIL_AC.z;
const FIN_AC_BASE_Z    = FIN_AC.z;
const THRUST_PT_BASE_Z = THRUST_PT.z;

// Jak mocno wychylenie powierzchni sterowej wpływa na siłę aerodynamiczną —
// prawdziwe (choć przybliżone) współczynniki aerodynamiczne, nie "krzywe
// autorytetu" dopasowane pod konkretne odczucie sterowania.
const ELEVATOR_MAX_RAD    = 0.35; // rad, ~20° maks. wychylenia steru wysokości
const ELEVATOR_CL_PER_RAD = 3.0;  // dCL/dδe usterzenia poziomego
const TAIL_AREA           = 31.0; // m² powierzchnia usterzenia poziomego
// NAPRAWA (zgłoszone: "próbuję lecieć w dół, a samolot bardzo mocno chce
// wrócić w górę — w powietrzu pitch nie powinien się prawie zmieniać sam"):
// jeden wspólny TAIL_CL_ALPHA (3.3) był używany JEDNOCZEŚNIE do (a) siły
// przywracającej kąt natarcia do wartowości trymu (statyczna stateczność —
// to WŁAŚNIE to "samo wraca w górę") i (b) tłumienia PRĘDKOŚCI kątowej
// pitch (przez człon z pitchRate w tailAlpha niżej). To DWIE różne rzeczy:
// (a) to "sprężyna" ciągnąca kąt z powrotem do trymu (silny efekt =
// realistyczne, ale tu niechciane "samoczynne" prostowanie pitch), a (b) to
// "tłumik" gaszący oscylacje BEZ ciągnięcia do konkretnego kąta. Rozdzielone
// na dwa niezależne współczynniki: STATIC drastycznie zmniejszony (słaba,
// prawie neutralna stateczność — pchnięty w dół nos zostaje w dole zamiast
// odbijać się z powrotem), RATE zostaje bez zmian (pełne tłumienie oscylacji,
// plus PITCH_DAMPING_GAIN niżej — to nadal działa niezależnie od tej zmiany).
// Zweryfikowane numerycznie: STATIC=0.7 daje ζ≈1.75 (przetłumiony, bez
// oscylacji) i bardzo słabą, ale wciąż BEZPIECZNIE dodatnią (stabilną)
// sztywność powrotu do trymu na każdej prędkości — poniżej ok. 0.3 układ
// staje się niestabilny (nie zmniejszaj poniżej tej wartości bez ponownej
// weryfikacji).
const TAIL_CL_ALPHA_STATIC = 0.7;  // 1/rad — siła "powrotu do trymu" (świadomie słaba, patrz wyżej)
const TAIL_CL_ALPHA_RATE   = 3.3;  // 1/rad — tłumienie prędkości pitch (jak wcześniej, bez zmian)

const RUDDER_MAX_RAD    = 0.35;
const RUDDER_CL_PER_RAD = 2.4;
const FIN_AREA          = 21.0; // m²
const FIN_CL_BETA       = 2.0;  // 1/rad — stateczność kierunkowa ("efekt chorągiewki")
// NAPRAWA (zgłoszone: "po skręcaniu lub użyciu ruddera heading zaczyna
// oscylować — samolot sie cały czas obraca lewo prawo, heading bez roll"):
// naturalne tłumienie yaw (z samego członu rate w finBeta) okazało się zbyt
// słabe — dawało bardzo wolno gasnący "dutch roll" (klasyczny, sprzężony
// tryb yaw+roll w samolotach) trwający 50+ sekund po każdym skręcie/ruderze.
// Ten sam pomysł co PITCH_DAMPING_GAIN wyżej: dodatkowy, jawny człon
// tłumiący niezależny od statecznika kierunkowego. Zweryfikowane
// symulacyjnie (Node, impuls rudder + puszczenie): bez tego heading osiada
// poniżej 1° dopiero po ~50s, z tym — po ~20s.
const YAW_DAMPING_GAIN  = 0.4;

const AILERON_MAX_RAD    = 0.30;
const AILERON_CL_PER_RAD = 0.09; // moment przechylający jako współczynnik bezwymiarowy (mnożony przez q·S·rozpiętość)
const ROLL_DAMPING_GAIN  = 0.35; // tłumienie przechylenia (odpowiednik Clp)
// Dodatkowe tłumienie pitch (odpowiednik Cmq spoza samego sprzężenia
// kąt-natarcia-usterzenia-z-pitchRate, patrz tailAlpha niżej) — realne
// samoloty mają więcej źródeł tłumienia pitch (kadłub, spóźnienie downwash,
// same skrzydło), których nie modelujemy osobno. Bez tego członu układ był
// wyraźnie niedotłumiony: zmierzone numerycznie ζ≈0.10 (stałe na każdej
// prędkości) — oscylacje o okresie kilku-kilkunastu sekund gasnące bardzo
// wolno, właśnie takie jak zgłoszone "dziwne oscylacje pitch". Wartość 1.0
// podnosi ζ do ok. 0.5 (wygodne, zbliżone do typowych airlinierów) —
// zweryfikowane numerycznie, stałe na każdej prędkości.
const PITCH_DAMPING_GAIN = 1.0;
// NAPRAWA v3 (zgłoszone: "pitch dąży zawsze do jakiegoś kata zależnego od
// klap [ok. 5°/6°/9°/10° dla flaps 0/1/2/3], nieważne co ustawię — chcę
// żeby trzymał DOKŁADNIE ten kąt/AoA, który mu nadam inputem"): PITCH_TRIM_RATE
// (wersja v2 wyżej) nadal nie był właściwym mechanizmem — choć szybszy, wciąż
// tylko "gonil" pitchRate=0, co NIE gwarantuje utrzymania KONKRETNEGO kąta:
// gdy pitchRate osiada w zerze, cała reszta układu (prędkość, kąt ścieżki
// lotu) i tak dalej dryfuje do JEDYNEJ, naturalnej równowagi wyznaczonej przez
// throttle+klapy — stąd zawsze ten sam kąt "docelowy", niezależnie od tego,
// co pilot ustawił drazkiem. To co jest naprawdę potrzebne, to PRAWDZIWE
// "attitude hold": kiedy pilot puszcza drążek, układ ma aktywnie UTRZYMYWAĆ
// dokładnie ten kąt pitch, w którym go zostawił — dokładnie tak działa
// prawdziwy A320/A321 fly-by-wire (prawo normalne pitch): neutralny sidestick
// = utrzymuj BIEżĄCĄ ścieżkę lotu/pitch, nie wracaj do jakiegoś stałego kąta.
//
// Implementacja: this.pitchHoldTarget (patrz konstruktor/reset) to kąt, który
// aktualnie ma być utrzymywany. Gdy pilot trzyma wyraźny input pitch, target
// NA BIEżĄCO podąża za aktualnym pitchRad (żeby w momencie puszczenia "złapać"
// dokładnie tam, gdzie pilot go zostawił). Gdy input jest bliski zeru, regulator
// PD (proporcjonalno-różniczkowy) koryguje pitchTrim na podstawie:
// (a) błędu kąta (pitchRad - pitchHoldTarget) — człon P,
// (b) bieżącej prędkości kątowej pitch (pitchRate) — człon D (tłumi ruch
//     W KIERUNKU odejscia od celu, niezależnie od aktualnego błędu).
// UWAGA NA ZNAK: zwiększanie pitchTrim daje moment NOS-W-DÓŁ (bo usterzenie
// jest za CG, patrz TAIL_AC.z<0) — więc gdy pitch jest ZA WYSOKO względem
// celu (błąd dodatni) lub rośnie (pitchRate dodatnie), trym musi ROSNĄĆ, nie
// maleć. Pierwsza próba implementacji miała ten znak odwrotnie i kończyła
// się pełnym przewrotem samolotu w każdym tekście — poprawiony znak
// zweryfikowany numerycznie (Node+three.js) w obu kierunkach.
//
// Zweryfikowane symulacyjnie na realistycznym manewrze (pilot pociąga drążek
// na 2s do różnych kątów, puszcza, obserwacja 238s = ponad 2 okresy phugoidu,
// wszystkie 4 ustawienia klap): KP=0.1, KD=0.1 trzyma zadany kąt w granicach
// ok. 2° bez dryfu i bez oscylacji. Wyższe wzmocnienia (KP≥0.2) zaczynają
// sprzęgać się z naturalnym (wolnym, ~90-100s) phugoidem samolotu i przy
// KP=0.3 układ staje się niestabilny (ucieczka w przeciągnięcie) — 0.1 ma
// solidny margines poniżej tej granicy.
// NAPRAWA v4 (zgłoszone: "jak puszczę sterowanie to pitch lata góra-dół od
// -15 do +30 stopni" — uporczywa oscylacja zamiast trzymania kąta): KP=0.1/
// KD=0.1 działało poprawnie TYLKO w moich wcześniejszych testach, bo tam
// "puszczenie" zawsze następowało po tym, jak pitchRate już zdążył opaść
// blisko zera. W realnej grze pilot puszcza drążek W TRAKCIE aktywnego
// obrotu (np. pitchRate=13°/s w chwili puszczenia to normalna sytuacja przy
// szybszym pociągnięciu) — samolot ma wtedy bezwładność (moment I_YY jest
// duży) i "przelatuje" znacznie dalej niż pitchHoldTarget złapany w tamtej
// chwili, zanim regulator zdąży to zahamować. Przy zbyt małym członie D
// (KD=0.1) to przestrzelenie nie było wystarczająco tłumione i układ wpadał
// w trwałą, praktycznie niegasnącą oscylację (sprzęgnięcie z naturalnym,
// słabo tłumionym phugoidem samolotu) zamiast jednorazowego przestrzelenia.
//
// Zweryfikowane symulacyjnie (Node+three.js) na REALISTYCZNYM scenariuszu
// (puszczenie drążka W TRAKCIE obrotu, nie po jego ustaniu, z różnymi siłami/
// czasami pociągnięcia, na wszystkich 4 ustawieniach klap): znacznie wyższy
// KD (1.5) względem KP (0.05) tłumi to przestrzelenie do jednorazowego,
// szybko gasnącego "nadstrzelenia" o kilka stopni zamiast trwałej oscylacji
// — sprawdzone na 300s ciągłej symulacji (pitch osiada na stałe, pitchRate
// spada do ~0.00°/s, bez najmniejszego śladu "polowania"). Wyższy KD ma sens
// fizycznie: bezwładność samolotu (I_YY) jest duża, więc tłumienie musi być
// odpowiednio silne względem członu pozycyjnego, inaczej układ jest
// niedotłumiony (klasyczny problem regulatora PD przy dużej bezwładności).
// NAPRAWA v5 (zgłoszone: "ustawiam pitch na 15, puszczam — spada, potem
// powoli wraca, trzeba kilka prób"): KP=0.05/KD=1.5 było za słabe względem
// rzeczywistej bezwładności/skali zaburzenia przy puszczeniu drazka w
// trakcie aktywnego obrotu — regulator POPRAWNIE kierunkowo koryguje
// (P i D działają we właściwym kierunku, zweryfikowane), ale zbyt wolno,
// więc samolot zdążył "przelecieć" kilka stopni obok celu, zanim korekta
// zdążyła zadziałać — stąd wrażenie "spada, potem wraca".
//
// PRÓBA ŚLEPA, KTÓRA NIE ZADZIAŁAŁA: "snap" trymu w chwili puszczenia,
// mający zachować CIĄGŁOŚĆ elevatorDeflection (przejąć natychmiast
// wychylenie trzymane przez pilota). To pogorszyło sprawę drastycznie —
// zachowywało pełne wychylenie "ciągnięcia" (np. -20° przy pełnym input)
// JUŻ PO puszczeniu drazka, więc samolot dalej dostawał ten sam silny
// moment nos-w-górę zamiast się zatrzymać — pitch leciał jeszcze wyżej
// zamiast się ustabilizować. WNIOSEK: ciągłość elevatorDeflection na
// przejściu NIE jest pożądana — to naturalne i poprawne, że moment
// gwałtownie maleje po puszczeniu (pilot już nie żąda aktywnej rotacji).
//
// WŁAŚCIWA NAPRAWA: zostawić mechanizm "złapania" celu bez zmian, ale
// znacząco podnieść OBA wzmocnienia (KP i KD razem, w mniej więcej stałej
// proporcji ~1:5), żeby korekta była szybsza. Zweryfikowane symulacyjnie
// (Node+three.js) na wielu scenariuszach naraz: (1) puszczenie w trakcie
// aktywnego obrotu przy różnej sile/czasie pociągnięcia, (2) długi lot
// hands-off z niedoskonałym trymem startowym (pierwszy zgłoszony bug), (3)
// duże dt (0.05s, symulacja spadku FPS) — KP=3.0/KD=15.0 daje przestrzelenie
// rzędu 2° (zamiast 5-8°) i dokładną zbieżność do złapanego celu na
// wszystkich 4 ustawieniach klap, bez oznak niestabilności nawet przy
// wzmocnieniach kilkukrotnie wyższych (testowane do KP=10/KD=30 — nadal
// stabilne, więc KP=3/KD=15 ma spory margines, nie jest granicą).
const PITCH_HOLD_KP = 0.2;  // NAPRAWA v6: obnizone z 3.0, patrz komentarz nizej
const PITCH_HOLD_KD = 60.0; // NAPRAWA v6: podniesione z 15.0, patrz komentarz nizej
const NOSEWHEEL_MAX_RAD  = 0.90; // maks. skret przedniego kola (~50st) - skutecznosc spada z predkoscia, patrz groundSteerTrackFactor()
// NAPRAWA v6 (zgłoszone: "ustawiam pitch na 10, leci do ~12, potem do ~8,
// potem do 10 i tam zostaje — chcę zeby po prostu doszlo do ~12 i tam
// zostalo, bez zawracania"): KP=3.0/KD=15.0 bylo nadal wyraznie niedotlumione
// (~2 stopnie przelotu w obie strony), mimo ze prosty licznik zmian znaku
// tego nie wykryl (blad metodologiczny w mojej wczesniejszej analizie).

// Podwozie: sztywność/tłumienie zawieszenia jako PRAWDZIWE siły sprężysto-
// -tłumiące, liczone wprost z geometrycznej głębokości penetracji terenu przez
// FAKTYCZNĄ pozycję/orientację bryły sztywnej (patrz komentarz przy
// GEAR_SUSP_OMEGA_MAIN niżej). Klasyczna metoda projektowania zawieszeń
// "quarter-car": k = m_narożnika·ω², c = 2ζω·m_narożnika, gdzie "masa
// narożnika" to udział masy samolotu przypadający na daną goleń.
const GEAR_LOAD_SHARE_NOSE = 0.08; // typowy udział przedniego koła w ciężarze samolotu
const GEAR_LOAD_SHARE_MAIN = 0.46; // każde koło główne (2×0.46 + 0.08 = 1.0)
// UWAGA: było `const` — teraz `let`, przeliczane w recomputeGearStiffness()
// gdy zmieni się masa (patrz applyAircraftWeight() niżej). Wzory bez zmian.
let GEAR_K_NOSE = A321_PARAMS.mass * GEAR_LOAD_SHARE_NOSE * GEAR_SUSP_OMEGA_NOSE ** 2;
let GEAR_C_NOSE = 2 * GEAR_SUSP_ZETA_NOSE * GEAR_SUSP_OMEGA_NOSE * A321_PARAMS.mass * GEAR_LOAD_SHARE_NOSE;
let GEAR_K_MAIN = A321_PARAMS.mass * GEAR_LOAD_SHARE_MAIN * GEAR_SUSP_OMEGA_MAIN ** 2;
let GEAR_C_MAIN = 2 * GEAR_SUSP_ZETA_MAIN * GEAR_SUSP_OMEGA_MAIN * A321_PARAMS.mass * GEAR_LOAD_SHARE_MAIN;

// ── Waga samolotu: paliwo + payload ─────────────────────────────────────────
// Realistyczne wartości dla A321-200 (silniki CFM56). Źródło: publicznie znane
// dane producenta/operatorów, zaokrąglone do rozsądnych wartości gry:

//   OEW (Operating Empty Weight, samolot pusty)         ≈ 48 500 kg
//   Max paliwo (zbiorniki skrzydłowe + centralny)        ≈ 23 700 kg
//   Max payload (pasażerowie + bagaż + cargo)            ≈ 22 000 kg
//   MTOW (Max Takeoff Weight)                            ≈ 93 500 kg
// UWAGA: OEW + max_paliwo + max_payload = 94 200 kg > MTOW — czyli da się
// wybrać suwakami kombinację przekraczającą MTOW (tak jak w prawdziwym
// samolocie — dlatego loadsheet/dyspozytor w ogóle sprawdza tę sumę). Patrz
// applyAircraftWeight(): masa jest wtedy TWARDO ograniczona do MTOW.
//
// Domyślne fuel/payload dobrane tak, że OEW+fuel+payload = DOKŁADNIE
// dotychczasowa masa (75 000 kg) — przy ustawieniach domyślnych fizyka
// zachowuje się identycznie jak przed dodaniem tej funkcji (zero regresji).
const A321_OEW_KG         = 48500;
const A321_MAX_FUEL_KG    = 23700;
const A321_MAX_PAYLOAD_KG = 22000;
const A321_MTOW_KG        = 93500;
const A321_DEFAULT_FUEL_KG    = 14500;
const A321_DEFAULT_PAYLOAD_KG = 12000; // 48500 + 14500 + 12000 = 75000 kg

// Ramiona przesunięcia CG (metry, oś Z lokalna — dziób dodatni) WZGLĘDEM
// domyślnego załadowania powyżej, per kg odchylenia od wartości domyślnej.
// Paliwo siedzi w skrzydłach — bardzo blisko CG z założenia konstrukcyjnego
// (samoloty tak się projektuje, żeby zużycie paliwa w locie nie psuło
// wyważenia) — stąd malutkie ramię. Payload (kabina + ładownie) rozkłada się
// głównie ZA skrzydłem (długi tylny kadłub, tylna ładownia) — jego ramię jest
// wyraźnie ujemne: więcej payloadu ciągnie CG do tyłu, mniej payloadu (bliżej
// samego OEW) — CG do przodu. To zgodne z realną praktyką linii lotniczych
// (doładowanie tylnej ładowni bywa świadomie używane do przesunięcia CG do
// tyłu i zmniejszenia oporu wywołanego wyważeniem).
const A321_FUEL_ARM_Z    = 0.3;
const A321_PAYLOAD_ARM_Z = -3.5;

// Stan czytany/zapisywany przez UI (sim-weight-ui.js). `pending*` to to, co
// aktualnie pokazują suwaki — NIE wpływa na fizykę, dopóki nie wywoła się
// applyAircraftWeight() (co dzieje się WYŁĄCZNIE z A321Entity.reset(), zgodnie
// z decyzją: tankowanie/załadunek liczy się przed startem, nie w locie).
// `applied*` to to, co faktycznie działa w fizyce od ostatniego reset() — UI
// pokazuje oba, żeby było widać czy suwak "czeka" na Reset.
const AircraftWeight = {
  pendingFuelKg:    A321_DEFAULT_FUEL_KG,
  pendingPayloadKg: A321_DEFAULT_PAYLOAD_KG,
  appliedFuelKg:    A321_DEFAULT_FUEL_KG,
  appliedPayloadKg: A321_DEFAULT_PAYLOAD_KG,
  appliedTotalMassKg: A321_OEW_KG + A321_DEFAULT_FUEL_KG + A321_DEFAULT_PAYLOAD_KG,
  appliedCgShiftM:    0,
  mtowExceededByKg:   0, // >0 gdy WYBRANA kombinacja przekraczała MTOW (masa i tak ograniczona do MTOW — patrz niżej)
};

// Przelicza bezwładność (patrz A321_IYY/IXX/IZZ) z aktualnej A321_PARAMS.mass.
// Sam kadłub/rozpiętość się nie zmieniają (promień żyracji zależy od
// geometrii, nie od załadowania) — zmienia się tylko masa we wzorze.
function recomputeInertia() {
  A321_IYY = A321_PARAMS.mass * (0.25 * A321_FUSELAGE_LEN) ** 2;
  A321_IXX = A321_PARAMS.mass * (0.23 * A321_PARAMS.span) ** 2;
  A321_IZZ = A321_PARAMS.mass * (0.27 * A321_FUSELAGE_LEN) ** 2;
}

// Przelicza sztywność/tłumienie zawieszenia (patrz GEAR_K/C_NOSE/MAIN) z
// aktualnej A321_PARAMS.mass — częstość własna (OMEGA) i tłumienie (ZETA)
// zostają te same (to własności amortyzatora, nie ładunku), zmienia się tylko
// obciążenie statyczne, które skaluje sztywność/tłumienie w tych wzorach.
function recomputeGearStiffness() {
  GEAR_K_NOSE = A321_PARAMS.mass * GEAR_LOAD_SHARE_NOSE * GEAR_SUSP_OMEGA_NOSE ** 2;
  GEAR_C_NOSE = 2 * GEAR_SUSP_ZETA_NOSE * GEAR_SUSP_OMEGA_NOSE * A321_PARAMS.mass * GEAR_LOAD_SHARE_NOSE;
  GEAR_K_MAIN = A321_PARAMS.mass * GEAR_LOAD_SHARE_MAIN * GEAR_SUSP_OMEGA_MAIN ** 2;
  GEAR_C_MAIN = 2 * GEAR_SUSP_ZETA_MAIN * GEAR_SUSP_OMEGA_MAIN * A321_PARAMS.mass * GEAR_LOAD_SHARE_MAIN;
}

// Czyste przeliczenie (BEZ efektów ubocznych — nie rusza A321_PARAMS.mass ani
// żadnej stałej fizyki) — używane w dwóch miejscach:
//  1) UI (sim-weight-ui.js) do podglądu na żywo podczas przesuwania suwaka,
//     ZANIM cokolwiek zostanie zastosowane do fizyki;
//  2) applyAircraftWeight() niżej, jako pierwszy krok przed efektami ubocznymi.
// Dzięki temu logika limitu MTOW/CG istnieje w jednym miejscu, a suwak może
// pokazywać "co by było gdyby" bez ryzyka przypadkowego dotknięcia fizyki
// w locie.
function computeAircraftWeight(fuelKg, payloadKg) {
  const fuel    = Math.max(0, Math.min(A321_MAX_FUEL_KG, fuelKg));
  const payload = Math.max(0, Math.min(A321_MAX_PAYLOAD_KG, payloadKg));
  const rawTotal = A321_OEW_KG + fuel + payload;

  // Limit MTOW + ostrzeżenie (decyzja): sam limit to twarde ograniczenie masy
  // użytej w fizyce; ostrzeżenie (exceededBy > 0) UI pokazuje osobno.
  const exceededBy = Math.max(0, rawTotal - A321_MTOW_KG);
  const total = exceededBy > 0 ? A321_MTOW_KG : rawTotal;

  // Przesunięcie CG liczone WZGLĘDEM domyślnego załadowania (patrz komentarz
  // przy A321_FUEL_ARM_Z) — przy fuel=domyślne i payload=domyślne zawsze da
  // dokładnie 0, niezależnie od tego czy total został przycięty do MTOW.
  const dFuel    = fuel    - A321_DEFAULT_FUEL_KG;
  const dPayload = payload - A321_DEFAULT_PAYLOAD_KG;
  const cgShiftZ = (dFuel * A321_FUEL_ARM_Z + dPayload * A321_PAYLOAD_ARM_Z) / total;

  return { fuel, payload, total, cgShiftZ, exceededBy };
}

// Punkt wejścia wywoływany WYŁĄCZNIE z A321Entity.reset() (patrz tam) — bierze
// pendingFuelKg/pendingPayloadKg (ustawione przez suwaki UI) i faktycznie
// przelicza masę, bezwładność, zawieszenie i przesunięcie CG. Bez zmiany
// wartości domyślnych ta funkcja zawsze da dokładnie taki sam wynik jak przed
// jej dodaniem (mass=75000, cgShiftZ=0) — zero regresji dla obecnego czucia
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
const GEAR_HARDSTOP_K_MULT = 12; // dodatkowa sztywność po przekroczeniu GEAR_SUSPENSION_TRAVEL (twardy zderzak — nie odbicie, tylko szybkie "zatrzymanie")

// Model opony: tarcie toczenia/hamowania wzdłuż kierunku jazdy + przyczepność
// boczna (grip). "Sztywność" (TIRE_*_STIFF) to liniowy model opony (siła ~
// prędkość poślizgu), odcięty na granicy tarcia Coulomba (mu·N) — standardowe,
// stabilne numerycznie podejście z dynamiki pojazdów.
const TIRE_ROLLING_MU  = 0.02;
const TIRE_BRAKE_MU    = 0.45;

// Autobrake: LOW/MED/MAX jako stała frakcja TIRE_BRAKE_MU (nie regulator
// stałego opóźnienia — patrz uzasadnienie przy autobrakeActive w
// physicsUpdate: siła tarcia skaluje się z chwilowym obciążeniem koła, więc
// efektywne opóźnienie i tak wychodzi w przybliżeniu stałe niezależnie od
// masy samolotu, bez potrzeby osobnej pętli regulacyjnej).
const AUTOBRAKE_MU_FRAC     = { LOW: 0.30, MED: 0.60, MAX: 1.0 };
const AUTOBRAKE_MIN_SPEED_KT = 10; // poniżej tej prędkości autobrake się rozłącza (blisko prędkości kołowania, jak w realu)
const TIRE_LAT_GRIP_MU = 0.8;
const TIRE_LONG_STIFF  = 2.2e5; // N/(m/s) przed odcięciem przez limit Coulomba
const TIRE_LAT_STIFF   = 3.5e5; // N/(m/s)

// Pomocnicze wzory na moment obrotowy z siły F={x,y,z} (składowe W LOKALNYM
// układzie samolotu — patrz toLocal() w physicsUpdate) przyłożonej w punkcie
// r={x,y,z} (lokalny offset od CG, np. TAIL_AC albo GEAR_LEFT). Wyprowadzone
// wprost z geometrii tego kodu (lokalne osie X=prawo/wingRight, Y=góra/acUp,
// Z=przód/noseDir) tak, by zgadzały się ze znakiem pitchRad/rollRad/yawRad już
// używanym w reszcie pliku (np. dodatnie pitchRad = nos w górę, jak w
// noseDir.y = sin(pitchRad) niżej) — nie są to wzory z podręcznika wklejone
// bez sprawdzenia znaku.
function _pitchTorque(r, F) { return r.z * F.y - r.y * F.z; }
// NAPRAWA (zgłoszone: "przechyla się w lewo, ale skręca w prawo"): pierwotna
// wersja tej funkcji (r.y*F.x - r.x*F.y) była wyprowadzona pod BŁĘDNY znak
// rollQ (patrz wyżej) — składowa Y wingRight/acUp była wtedy DOKŁADNIE
// PRZECIWNA do tego, co faktycznie pokazuje mesh.rotation.set(...,'YXZ') na
// ekranie (zweryfikowane numerycznie w Node z biblioteką three.js). Skutek:
// bank w lewą był poprawny WIZUALNIE (mesh nie zależy od tej funkcji), ale
// siła nośna/reakcje podwozia liczyły skręt tak, jakby to był bank w prawą.
// Ta wersja (r.x*F.y - r.y*F.x, standardowa formuła bez odwrócenia znaku) jest
// spójna z poprawionym rollQ i zweryfikowana na 3 niezależnych przypadkach
// (podwozie lewe/prawe, statecznik pionowy).
function _rollTorque(r, F)  { return r.x * F.y - r.y * F.x; }
function _yawTorque(r, F)   { return r.z * F.x - r.x * F.z; }

// NAPRAWA (realizm): siła nośna była liczona wzdłuż osi "górnej" SAMOLOTU
// (acUp, obróconej razem z pitchiem), a nie wzdłuż osi prostopadłej do
// PRĘDKOŚCI (tzw. wind axis) — to standardowa, podręcznikowa konwencja:
// siła nośna ⊥ względny wiatr, opór ∥ względny wiatr (opór już tak liczono:
// dragVec = -vel.normalize()*dragMag, patrz physicsUpdate). Przy fpa=0 (lot
// poziomy) i niezerowym kącie natarcia (alpha=pitchRad) dawało to siłę
// nośną SZTUCZNIE przechyloną do tyłu o kąt alpha, co wymagało dużo więcej
// ciągu niż w rzeczywistości (zweryfikowane: przy alpha=8.3° prawdziwa
// równowaga sił wymagała throttle=0.63 zamiast fizycznie sensownego ~0.27)
// i dawało fałszywą, dodatkową siłę poziomą podczas dużych wychyleń alpha
// (np. w trakcie phugoidu czy przeciągnięcia — część przyczyny zgłoszonej
// niestabilności pitch, patrz NAPRAWA przy flapCl[1] wyżej). Poprawka:
// liczymy kierunek "górny" względem PRĘDKOŚCI (windUp), nie względem
// pitchu — pokrywają się dokładnie wtedy, gdy alpha=0, tak jak powinno być.
// Zweryfikowane symulacyjnie (Node+three.js): trym po poprawce daje
// throttle≈0.265/0.323 (flaps=0/1) — niemal identyczne z niezależnie
// policzonym podręcznikowym L=ciężar/T=opór, co potwierdza poprawność.
// Dotyczy TYLKO skrzydła i usterzenia poziomego (liftVec/tailForceVec) —
// statecznik pionowy/ster kierunku i lotki NIE zmienione (osobny, jeszcze
// niezweryfikowany temat dla osi yaw/roll — patrz notatka).
function _computeWindUp(vel, wingRight, acUp, airspeed) {
  if (airspeed < 3) return acUp; // za wolno, żeby kierunek prędkości był miarodajny — fallback do dawnej osi
  const velDir = vel.clone().divideScalar(airspeed);
  const w = new THREE.Vector3().crossVectors(velDir, wingRight);
  const len = w.length();
  if (len < 0.05) return acUp; // niemal równoległe do wingRight (skrajny poślizg/lot bokiem) — degeneracja, fallback
  return w.divideScalar(len);
}

// Środek między kołami głównymi (lewym i prawym) — najniższy, najbardziej
// reprezentatywny pojedynczy punkt do TANIEGO sprawdzania odległości od ziemi,
// gdy samolot jest wysoko (patrz GEAR_FAR_CHECK_* niżej).
const GEAR_MAIN_MID = { x: (GEAR_LEFT.x + GEAR_RIGHT.x) / 2, y: GEAR_LEFT.y, z: GEAR_LEFT.z };

// Z dala od ziemi nie ma sensu liczyć dokładnie WSZYSTKICH 3 punktów podwozia
// co klatkę — zamiast tego co klatkę sprawdzamy TYLKO wysokość GEAR_MAIN_MID
// nad terenem (jeden tani odczyt zamiast trzech). To wciąż dzieje się co
// klatkę (60x/s), a nie rzadziej — przy sprawdzaniu np. co 0.2 s samolot przy
// dużej prędkości mógłby "wjechać" w strome zbocze/górę między dwoma
// sprawdzeniami, zanim zdąży przełączyć się na tryb dokładny. Gdy wysokość
// spadnie poniżej GEAR_FAR_CHECK_ENTER_AGL, przechodzimy w tryb dokładny (3
// punkty, co klatkę) i zostajemy w nim, dopóki nie oddalimy się z zapasem
// powyżej GEAR_FAR_CHECK_EXIT_AGL (histereza, żeby nie przełączać się w kółko).
const GEAR_FAR_CHECK_ENTER_AGL = 120; // m — poniżej tej wysokości włącz dokładne sprawdzanie 3 punktów
const GEAR_FAR_CHECK_EXIT_AGL  = 150; // m — powyżej tej wysokości wróć do taniego sprawdzania 1 punktem (zapas histerezy jak wcześniej)

// Jeśli którekolwiek koło jest zanurzone w terenie głębiej niż to (kilka metrów,
// znacznie więcej niż normalne ugięcie zawieszenia GEAR_SUSPENSION_TRAVEL) —
// to nie jest zwykłe lądowanie, tylko prawdziwa sytuacja awaryjna (np. stromy
// lot nurkowy, teleportacja, spawn w złym miejscu) — samolot szybko (ale
// płynnie, nie w jednej klatce) wraca na powierzchnię — patrz GEAR_EMERGENCY_SETTLE_TAU.
const GEAR_EMERGENCY_PEN_M = 10; // m
const GEAR_EMERGENCY_SETTLE_TAU = 0.05; // s — znacznie szybsze niż normalne osiadanie, ale nie natychmiastowe (łagodniejszy "wypchnij na powierzchnię")

// DEBUG: pomaga namierzyć przypadki zapadania się samolotu pod ziemię (patrz
// sampleGearPoint/_debugZoomWarn i settleOnGear). Wyłącz w konsoli przeglądarki
// wpisując: DEBUG_GEAR = false
window.DEBUG_GEAR = window.DEBUG_GEAR ?? true;
// DEBUG: prosty log stanu pitch/input co DEBUG_HEARTBEAT_SEC sekund, w zwięzłym
// formacie klucz=wartość (do wklejenia wprost przy debugowaniu ustawień pitch/
// attitude-hold). Wyłącz w konsoli przeglądarki wpisując: DEBUG_PITCH = false
window.DEBUG_PITCH = window.DEBUG_PITCH ?? true;
const DEBUG_HEARTBEAT_SEC = 1.0; // co ile sekund wypisywać bieżący stan (patrz koniec physicsUpdate)

// ── Kulki-znaczniki 3 punktów kolizji podwozia ─────────────────────────
//
// Małe kolorowe kule pokazujące dokładnie te same 3 punkty, które silnik fizyki
// używa do wykrywania kontaktu z ziemią (GEAR_NOSE/GEAR_LEFT/GEAR_RIGHT) — świecą
// pełnym kolorem gdy dane koło dotyka/koliduje z terenem, są przygaszone gdy nie.
// Czysto wizualny debug/feedback, nie wpływa na fizykę.
const GEAR_MARKER_RADIUS = 0.35; // m
const GEAR_MARKER_COLORS = {
  nose:  0xffdd33, // żółty  — przednie koło
  left:  0x33ccff, // niebieski — lewe główne koło
  right: 0xff3355, // czerwony — prawe główne koło
};

// ── Prawdziwy cień 3D samolotu (rzut RZECZYWISTEJ geometrii modelu na teren
//    wzdłuż kierunku Słońca) ────────────────────────────────────────────────
//
// W przeciwieństwie do poprzedniej wersji (ręcznie narysowany, przybliżony
// obrys), obrys cienia jest teraz wyliczony z PRAWDZIWYCH wierzchołków
// wczytanego a321.obj: po wczytaniu modelu bierzemy WSZYSTKIE wierzchołki
// wszystkich części (kadłub, skrzydła, statecznik — z wyłączeniem elementów
// wewnętrznych typu cockpit_inside/interface, które i tak są w całości
// wewnątrz bryły kadłuba i nie mogą poszerzyć sylwetki), rzutujemy je na
// płaszczyznę X-Z (widok z góry, w LOKALNYM układzie samolotu — ten sam co
// GEAR_NOSE/LEFT/RIGHT) i liczymy 2D convex hull (otoczkę wypukłą) tego rzutu.
// To daje dokładny, prawdziwy kontur sylwetki samolotu z góry — bez
// zgadywania wymiarów, i bez ryzyka samoprzecinających się trójkątów (hull
// jest z definicji wypukły, więc triangulacja "fan" od centroidu zawsze
// wychodzi poprawnie, inaczej niż przy ręcznie rysowanym, nie do końca
// wypukłym obrysie).
//
// Liczenie hull z ~35 tys. wierzchołków trwa rzędu kilkudziesięciu
// milisekund — WYKONYWANE WYŁĄCZNIE RAZ, zaraz po wczytaniu modelu (patrz
// .then() w konstruktorze), NIE co klatkę. Co klatkę (_updateShadow) używamy
// już tylko tego gotowego, małego zestawu punktów obrysu (typowo kilkanaście-
// kilkadziesiąt), dokładnie tak jak poprzednio dla ręcznego obrysu.

// Nazwy części modelu POMIJANE przy liczeniu obrysu — elementy wnętrza
// kokpitu leżą całkowicie wewnątrz bryły zewnętrznej kadłuba i tylko
// spowalniałyby liczenie hull bez żadnego wpływu na wynik.
const SHADOW_HULL_EXCLUDE_PREFIXES = ['cockpit_inside', 'cockpit_interface'];

// Andrew's monotone chain — 2D convex hull, O(n log n), zwraca punkty w
// kolejności przeciwnej do ruchu wskazówek zegara (CCW), bez duplikatu
// punktu początkowego na końcu.
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

// Wyciąga WSZYSTKIE wierzchołki geometrii z modelu (a321.obj) PO zastosowaniu
// jego własnej transformacji (rotation.y=A321_MODEL_ROT_Y, scale, translateY —
// ustawione w konstruktorze PRZED wywołaniem tej funkcji), ale NIEZALEżNIE od
// pozycji/orientacji całej encji w świecie (`grp`) — czyli dokładnie w tych
// samych, lokalnych współrzędnych względem origin encji co GEAR_NOSE/LEFT/RIGHT.
// Liczymy transformację KAŻDEGO node'a względem `model` ręcznie (idziemy w
// górę łańcucha rodziców aż do `model` włącznie), a NIE przez
// `node.matrixWorld` — to ostatnie włączyłoby też aktualną, zmienną w czasie
// pozycję `grp` w świecie, której tu NIE chcemy (hull liczymy raz, niezależnie
// od tego, gdzie samolot akurat lata). Rzutuje na płaszczyznę X-Z (widok z
// góry) i liczy convex hull. Zwraca tablicę { x, z } gotową do użycia jako
// obrys cienia.
function computeShadowHullFromModel(model) {
  const pts = [];
  const v = new THREE.Vector3();
  model.updateMatrix();
  const modelMatrix = model.matrix;
  model.traverse(node => {
    if (!node.isMesh || !node.geometry || node === model) return;
    if (SHADOW_HULL_EXCLUDE_PREFIXES.some(p => node.name.startsWith(p))) return;
    const posAttr = node.geometry.attributes.position;
    if (!posAttr) return;

    // Łańcuch macierzy lokalnych od `model` (wyłącznie) do `node` włącznie.
    const chain = [];
    let cur = node;
    while (cur && cur !== model) {
      cur.updateMatrix();
      chain.unshift(cur.matrix);
      cur = cur.parent;
    }
    const full = modelMatrix.clone();
    for (const m of chain) full.multiply(m);

    for (let i = 0; i < posAttr.count; i++) {
      v.fromBufferAttribute(posAttr, i).applyMatrix4(full);
      pts.push({ x: v.x, z: v.z });
    }
  });
  if (pts.length < 3) return null;
  return _convexHull2D(pts);
}

// Triangulacja "fan" od centroidu — poprawna dla WYPUKŁEGO wielokąta (convex
// hull jest z definicji wypukły, więc to zawsze daje poprawną, nieprzecinającą
// się triangulację, w przeciwieństwie do ręcznie rysowanego obrysu wcześniej).
function _buildShadowFanIndices(n) {
  const idx = [];
  for (let i = 0; i < n; i++) {
    idx.push(0, 1 + i, 1 + ((i + 1) % n));
  }
  return new Uint16Array(idx);
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

// (Dawny elevatorAuthority()/ELEVATOR_MIN_KT/FULL_KT — sztuczna krzywa "siły
// autorytetu steru" zależna od prędkości — został USUNIĘTY. W nowym modelu to
// samo zjawisko (ster wysokości nic nie daje przy małej prędkości, coraz
// więcej przy większej) wynika WPROST z fizyki: siła aerodynamiczna na
// usterzeniu ~ q = ½ρV², więc naturalnie rośnie z KWADRATEM prędkości bez
// żadnej dodatkowej, ręcznie dopasowanej krzywej — patrz ELEVATOR_CL_PER_RAD i
// TAIL_AC w physicsUpdate.)

// ── Odbicie sprężyste przy mocnym/nietypowym uderzeniu w teren ────────────────
//
// Normalne, łagodne osiadanie na 3 punktach podwozia (patrz settleOnGear) zostaje
// bez zmian — to obsługuje zwykłe lądowania i kołowanie. Ale gdy samolot uderzy
// w teren z dużą prędkością PIONOWĄ (twarde lądowanie / "zaorywanie" ziemi) albo
// wjedzie w stromą ścianę terenu przy dużej prędkości POZIOMEJ (np. w zbocze
// góry), to nie jest już "osiadanie zawieszenia" — to zderzenie, które powinno
// fizycznie odrzucić samolot: odbicie wektora prędkości względem normalnej
// terenu w miejscu uderzenia, z tłumieniem (coefficient of restitution) — część
// energii uderzenia jest tracona (deformacja/hałas/ciepło), reszta wraca jako
// odbicie, dokładnie jak przy zderzeniu sprężystym z tłumieniem.
const BOUNCE_TRIGGER_VSPEED   = 7.2;  // m/s prędkości pionowej w dół — od tego uznajemy uderzenie za "twarde" (nie zwykłe osiadanie)
const BOUNCE_TRIGGER_HSPEED_INTO_SLOPE = 8.5; // m/s składowej prędkości WCHODZĄCEJ w stromy teren (wzdłuż normalnej), przy locie w zbocze
// NAPRAWA: `velIntoSlope` rośnie z CAŁKOWITą prędkością (≈ prędkość_pozioma
// × sin(nachylenie)) — bez dolnego progu kąta, przy dużej prędkości naziemnej
// (200+ kt) zwykłe, drobne pofałdowanie pasa (4-5°, normalny szum terenu)
// wystarczało, żeby przekroczyć 8.5 m/s i wywołać "twarde odbicie od zbocza" —
// mechanikę pomyślaną do RZECZYWISTEGO wlecenia w stok góry, nie do kolejnych
// nierówności płyty. Stąd fałszywe mikro-odbicia właśnie przy dużych
// prędkościach, które rozbijały próby czystej rotacji na starcie.
const BOUNCE_INTO_SLOPE_MIN_DEG = 18; // ° — poniżej tego kąta to zwykły szum terenu, nie "zbocze", niezależnie od prędkości (podniesione z 12° — przy dużej prędkości rozbiegu drobne pofałdowanie DEM nadal dawało czasem >12° i wywoływało fałszywe odbicia)
const BOUNCE_RESTITUTION      = 0.28; // ułamek prędkości normalnej odbitej z powrotem (0=brak odbicia/pochłonięte, 1=idealnie sprężyste)
const BOUNCE_TANGENT_DAMPING  = 0.82; // ułamek prędkości stycznej zachowanej po uderzeniu (tarcie/poślizg podczas odbicia)
const BOUNCE_MIN_UP_SPEED     = 1.8;  // m/s — minimalna prędkość "w górę" nadana przy odbiciu, żeby efekt był czytelny nawet przy uderzeniu prawie stycznym
// (Dawne BOUNCE_ON_GROUND_SLOPE_DEG/MIN_SPEED i GROUND_SLOPE_ACCEL_GAIN/DAMPING
// zostały USUNIĘTE — to były ręczne "łatki" udające efekt zjeżdżania po zboczu
// i odskakiwania od jego ściany. W nowym modelu obie rzeczy wynikają WPROST z
// prawdziwych sił: niezrównoważona składowa grawitacji wzdłuż stoku naturalnie
// przyspiesza samolot w dół zbocza, a reakcja normalna terenu pod kątem robi
// swoje bez potrzeby osobnej "kary" za stromiznę.)

const planeInput = {
  pitch: 0, roll: 0, yaw: 0,
  throttleUp: false, throttleDown: false,
  brakes: false,
};

// ── Bufory wielokrotnego użytku dla _updateShadow() ────────────────────────
// Alokowane RAZ (nie co klatkę/punkt) — _updateShadow() liczy do 18 punktów co
// klatkę, więc unikanie alokacji tu ma realne znaczenie dla GC/framerate.
const _shadowLightDir  = new THREE.Vector3();
const _shadowLocalVec  = new THREE.Vector3();
const _shadowWorldVec  = new THREE.Vector3();
const _shadowHitVec    = new THREE.Vector3();
const _shadowEuler     = new THREE.Euler();
const _shadowQuat      = new THREE.Quaternion();
let   _shadowLastGroundY = 0;
function _clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// ── Encja samolotu A321 ────────────────────────────────────────────────────────

class A321Entity extends Entity {
  constructor(opts = {}) {
    super(Object.assign({ type: 'aircraft' }, opts));
    this.yawRad   = opts.yawRad   ?? 0;
    this.pitchRad = opts.pitchRad ?? 0;
    this.rollRad  = 0;
    this.pitchRate = 0; this.rollRate = 0; this.yawRate = 0;
    this.vel = new THREE.Vector3(0, 0, 0);
    this.throttle = 0;
    this.reverserDeployFrac = 0; // 0=schowany, 1=w pełni wysunięty (patrz reverse thrust w physicsUpdate)
    this.parkingBrake = false;
    this.autobrakeLevel = 'OFF'; // 'OFF' | 'LOW' | 'MED' | 'MAX' — patrz AUTOBRAKE_MU_FRAC
    this.flaps = 1;
    this.gearDown = true;
    this.spoilers = false;
    this.onGround = true;
    // Tryb dokładnego sprawdzania podwozia (patrz GEAR_FAR_CHECK_* i sampleGearPoint/sampleGear).
    // Start jako "blisko ziemi" — bezpieczny domyślny stan tuż po starcie/spawnie.
    this._nearGroundZone = true;
    this.airspeed = 0;
    this.vs = 0;
    this._alpha = 0; this._cl = 0; this._isStalling = false;
    this.terrainZoom = 15; // maks. dostępna dokładność danych wysokościowych (~3 m/px) — tyle samo, co dla renderowanego terenu (patrz sim-terrain.js: buildMeshWithNeighbors ogranicza DEM do z15)

    const grp = new THREE.Group();
    this.mesh = grp;
    this.modelLoaded = false;
    this._parts = {}; // cache animowanych części — wypełniane po wczytaniu modelu

    // Kulki-znaczniki 3 punktów kolizji podwozia (patrz GEAR_MARKER_*) — osobne
    // meshe DODANE BEZPOŚREDNIO DO SCENY (nie do `grp`), bo mają własną pozycję
    // światową liczoną z sampleGear() (a nie transformację względem samolotu).
    this._gearMarkers = {};
    for (const k of ['nose', 'left', 'right']) {
      const mat = new THREE.MeshBasicMaterial({ color: GEAR_MARKER_COLORS[k], transparent: true, opacity: 0.35, depthTest: false });
      const m = new THREE.Mesh(new THREE.SphereGeometry(GEAR_MARKER_RADIUS, 12, 10), mat);
      m.renderOrder = 999;
      m.visible = false;
      scene.add(m);
      this._gearMarkers[k] = m;
    }
    // Cień 3D w kształcie PRAWDZIWEJ sylwetki modelu — nie możemy zbudować go
    // TERAZ (model jeszcze się nie wczytał, a hull=obrys zależy od jego
    // geometrii). Zbudujemy go leniwie, w .then() poniżej, zaraz po
    // computeShadowHullFromModel(). Do tego czasu cień po prostu nie istnieje
    // (nie jest jeszcze dodany do sceny) — to bezpieczne, bo _updateShadow()
    // sprawdza `if (!this._shadow) return;` na starcie.
    this._shadow = null;
    this._shadowHull = null;
    this._shadowPos = null;
    // Stan odbicia sprężystego (patrz applyBounce()) — licznik krótkiego "cooldownu"
    // żeby jedno mocne uderzenie nie wywoływało kilku odbić pod rzędem w kolejnych
    // klatkach, zanim samolot zdąży się realnie oddalić od terenu.
    this._bounceCooldown = 0;

    // Zapisujemy promise na encji (bez zmiany zachowania — .then/.catch działają
    // jak wcześniej) tak, by init() w sim-main.js mógł na niego poczekać i
    // zgłosić realny postęp na ekranie ładowania zamiast pokazywać go "na oko".
    this.modelReadyPromise = loadA321Model().then(model => {
      model.rotation.y = A321_MODEL_ROT_Y;
      model.scale.setScalar(A321_MODEL_SCALE);
      model.translateY(A321_MODEL_TRANSLATE_Y);
      grp.add(model);
      this.modelLoaded = true;
      this.updateGearVisibility();

      // Buduj cień z PRAWDZIWEJ geometrii modelu, TERAZ gdy model.matrix jest
      // już ustawiona (rotation.y/scale/translateY wyżej) — patrz
      // computeShadowHullFromModel(). Liczone WYŁĄCZNIE RAZ (koszt rzędu
      // kilkudziesięciu ms dla ~35 tys. wierzchołków), NIE co klatkę.
      const hull = computeShadowHullFromModel(model);
      if (hull && hull.length >= 3) {
        this._shadowHull = hull;
        const n = hull.length;
        const shadowGeo = new THREE.BufferGeometry();
        const shadowPosArr = new Float32Array((n + 1) * 3);
        shadowGeo.setAttribute('position', new THREE.BufferAttribute(shadowPosArr, 3));
        shadowGeo.setIndex(new THREE.BufferAttribute(_buildShadowFanIndices(n), 1));
        this._shadow = new THREE.Mesh(
          shadowGeo,
          new THREE.MeshBasicMaterial({
            color: 0x000000,
            transparent: true,
            opacity: 0.45,
            depthWrite: false,
            depthTest: true,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: -4,
            polygonOffsetUnits: -4,
          })
        );
        this._shadow.renderOrder = 998;
        this._shadow.frustumCulled = false;
        this._shadow.visible = false;
        this._shadowPos = shadowPosArr;
        scene.add(this._shadow);
      } else {
        console.warn('[A321] Nie udało się policzyć obrysu cienia z geometrii modelu (za mało wierzchołków?) — cień będzie wyłączony.');
      }

      // Wyszukaj animowane części RAZ — getObjectByName() przechodzi cały graf
      // sceny, więc robienie tego co klatkę (jak wcześniej w renderUpdate) jest
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
        // Jeśli obiekt miał już jakąś pozycję z pliku (np. nie zero), musimy dodać nowy środek
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
      // NAPRAWA (zgłoszone: "punkt obrotu ruddera jest za bardzo do przodu"):
      // brakowało tego wywołania dla steru kierunku — obracał się więc wokół
      // surowego originu z pliku .obj zamiast prawdziwej linii zawiasu
      // wyliczonej z geometrii (tak jak elevatory powyżej).
      setupControlSurfaceHinge(this._parts.rudder);

    }).catch(err => console.error('[A321] Błąd wczytywania modelu:', err));

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
    // Zastosuj aktualne ustawienia paliwa/payloadu z suwaków UI (patrz
    // AircraftWeight/applyAircraftWeight w sekcji "Waga samolotu" wyżej w tym
    // pliku) — zgodnie z decyzją, tankowanie/załadunek liczy się TYLKO tutaj,
    // przy reset/starcie, nigdy na żywo w trakcie lotu.
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
    this.reverserDeployFrac = 0; // rewerser fizycznie schowany po reset — nie jest to "ustawienie" jak autobrake/parking brake
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

  // DEBUG: rzuca ostrzeżenie w konsoli, gdy wysokość terenu pod danym punktem
  // NIE pochodzi z najdokładniejszego dostępnego DEM (this.terrainZoom, domyślnie
  // Z15) — czyli w tym miejscu jeszcze się nie wczytał. Throttlowane per punkt,
  // żeby nie zasypać konsoli, gdyby to trwało dłuższą chwilę. Wyłączane przez
  // window.DEBUG_GEAR = false w konsoli przeglądarki.
  _debugZoomWarn(label, lat, lon, zoomUsed) {
    if (!window.DEBUG_GEAR) return;
    if (!this._debugZoomLog) this._debugZoomLog = {};
    const now = performance.now();
    const last = this._debugZoomLog[label];
    if (last && last.zoom === zoomUsed && now - last.t < 2000) return;
    this._debugZoomLog[label] = { zoom: zoomUsed, t: now };
    console.warn(
      `[GEAR DEBUG] "${label}": brak DEM Z${this.terrainZoom} w (${lat.toFixed(6)}, ${lon.toFixed(6)}) ` +
      `— użyto Z${zoomUsed} zamiast. onGround=${this.onGround} altM=${this.altM.toFixed(1)}`
    );
  }

  // Próbkuje teren pod JEDNYM punktem lokalnym samolotu (offset w metrach
  // względem origin encji, w lokalnym układzie +X prawo/+Y góra/+Z dziób).
  // noseDir/wingRight/acUp to jednostkowe wektory lokalnych osi samolotu już
  // przeliczone na przestrzeń świata — liczone wcześniej w physicsUpdate().
  // Zwraca: przesunięcie względem origin encji, wysokość n.p.m. tego punktu,
  // wysokość terenu pod nim, penetrację (dodatnia = punkt już w/pod ziemią) i
  // zoomUsed (DEBUG: z jakiego zoomu DEM faktycznie pochodzi wysokość).
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

  // Próbkuje teren NIEZALEŻNIE pod każdym z 3 punktów podwozia (przednie koło,
  // lewe i prawe główne) — patrz sampleGearPoint().
  sampleGear(noseDir, wingRight, acUp) {
    return {
      nose:  this.sampleGearPoint(GEAR_NOSE,  noseDir, wingRight, acUp, 'nose'),
      left:  this.sampleGearPoint(GEAR_LEFT,  noseDir, wingRight, acUp, 'left'),
      right: this.sampleGearPoint(GEAR_RIGHT, noseDir, wingRight, acUp, 'right'),
    };
  }

  // Liczy przybliżoną normalną terenu (jednostkowy wektor w górę, prostopadły do
  // zbocza) pod dowolnym punktem geo, próbkując wysokość w 4 sąsiednich punktach
  // (różnice centralne) — potrzebne do applyBounce(), żeby odbicie od stromego
  // zbocza szło w sensownym kierunku, nie tylko pionowo w górę.
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

  // Odbicie sprężyste przy mocnym/nietypowym uderzeniu w teren (patrz BOUNCE_*).
  // Wywoływane raz, w chwili świeżego, twardego kontaktu — modyfikuje this.vel
  // bezpośrednio (odbija składową normalną, tłumi składową styczną). Zwraca true
  // jeśli faktycznie doszło do odbicia.
  //
  // (Dawny trzeci wyzwalacz "hardGroundDrop" — odbicie przy zwykłej jeździe po
  // ziemi w stronę stromizny — został USUNIĘTY: w nowym modelu każda z 3 goleni
  // ma WŁASNĄ, prawdziwą siłę sprężysto-tłumiącą liczoną wzdłuż faktycznej
  // normalnej terenu (patrz physicsUpdate), więc jazda po nierównym/pochłym
  // terenie sama w sobie już nie potrzebuje osobnej "ucieczki" — samolot po
  // prostu naturalnie podskakuje/przechyla się zgodnie z siłami z każdej goleni.
  // Ta funkcja zostaje wyłącznie dla PRAWDZIWYCH zderzeń: twarde lądowanie
  // (duża prędkość pionowa) albo wlecenie w stromą ścianę terenu przy dużej
  // prędkości poziomej.)
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
      console.warn(`[BOUNCE] Twarde uderzenie w teren (${best.key}) — impactVy=${impactVy.toFixed(1)} m/s, velIntoSlope=${velIntoSlope.toFixed(1)} m/s, slope=${slopeAngleDeg.toFixed(1)}° → odbicie ${bounceSpeed.toFixed(1)} m/s wzdłuż normalnej.`);
    }
    return true;
  }

  // Cała integracja pozycji (lat/lon/altM) dzieje się wewnątrz physicsUpdate()
  // (bo tam liczymy realne przyspieszenia z sił/momentów) — ten override MUSI
  // zostać pusty, inaczej odziedziczony Entity.integrate() spróbowałby ruszyć
  // samolotem przez nieużywane tu this.velNED (którego A321Entity nigdy nie
  // ustawia), co albo nic by nie robiło, albo psuło pozycję w zależności od
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

    // Throttle: 0..1 = normalny zakres do przodu (bez zmian). Poniżej zera =
    // reverse thrust — TYLKO na ziemi, dokładnie jak w prawdziwym samolocie
    // (przepustnice reverse są mechanicznie zablokowane w locie, odblokowuje
    // je czujnik obciążenia podwozia/"weight on wheels" po dotknięciu pasa).
    // this.onGround pochodzi z POPRZEDNIEJ klatki (patrz komentarz o orientacji
    // wyżej) — to ten sam, już istniejący wzorzec w tym pliku.
    if (input.throttleUp) this.throttle = Math.min(1, this.throttle + dtCap * 0.6);
    if (input.throttleDown) {
      const minThrottle = this.onGround ? -1 : 0;
      this.throttle = Math.max(minThrottle, this.throttle - dtCap * 0.8);
    }
    // Bezpiecznik: gdyby samolot oderwał się od ziemi z wybranym reverse
    // (np. odbicie/bounced landing), natychmiast wróć do zera — nie da się
    // fizycznie latać z wysuniętymi rewersorami.
    if (!this.onGround && this.throttle < 0) this.throttle = 0;

    // Rewersory potrzebują chwili na fizyczne wysunięcie/schowanie (jak
    // translating cowl w prawdziwym silniku) — ciąg wsteczny narasta dopiero
    // wraz z reverserDeployFrac, nie skokowo. Chowają się szybciej niż się
    // wysuwają (tak jak w realu — bezpieczeństwo przy go-around).
    const reverserTarget = (this.throttle < -0.001 && this.onGround) ? 1 : 0;
    const reverserRate = (reverserTarget > this.reverserDeployFrac) ? (dtCap / 1.6) : (dtCap / 0.9);
    this.reverserDeployFrac += Math.max(-reverserRate, Math.min(reverserRate, reverserTarget - this.reverserDeployFrac));

    const airspeed = this.vel.length();
    const speedKt = Units.msToKt(airspeed);
    const pitchInput = input.pitch;
    const rollInput  = input.roll;
    const yawInput   = input.yaw;
    // Zapamiętane dla HUD (sim-hud.js) — czy hamulce main gear są w tej
    // klatce faktycznie zaciśnięte (manualnie albo parking brake). Autobrake
    // ma osobny wskaźnik (this.autobrakeLevel), bo działa niezależnie.
    this.brakesActiveDisplay = !!input.brakes || this.parkingBrake;

    // ── Orientacja z POPRZEDNIEGO kroku — z niej liczymy WSZYSTKIE siły i momenty
    // w tej klatce (kąty same zmienią się dopiero na końcu funkcji, gdy
    // zintegrujemy przyspieszenia kątowe). To poprawna kolejność dla bryły
    // sztywnej: siły zależą od aktualnego stanu, dopiero potem stan się
    // aktualizuje na podstawie tych sił — a nie odwrotnie. ──────────────
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

    // Prędkość kątowa bryły W ŚWIECIE, z aktualnych (skalarnych) pitchRate/
    // rollRate/yawRate — oś pitch to -wingRight (patrz derywacja przy noseDir.y),
    // oś roll to +noseDir (zgodnie ze standardową regułą prawej dłoni, bo
    // rollQ powyżej już UżYWA +this.rollRad, nie -this.rollRad — NAPRAWA:
    // zweryfikowane numerycznie, że ten znak zgadza się z mesh.rotation.set(...,
    // rollRad, 'YXZ') używanym w syncMesh(); poprzednia wersja z minusem dawała
    // wingRight/acUp DOKŁADNIE PRZECIWNE do tego co widział gracz na ekranie —
    // stąd zgłoszony bug "przechyla się w lewo poprawnie, ale skręca w prawo").
    const omegaWorld = wingRight.clone().multiplyScalar(-this.pitchRate)
      .addScaledVector(noseDir, this.rollRate)
      .addScaledVector(worldUp, this.yawRate);

    // Rzutuje wektor siły ze świata na lokalne osie samolotu — wzory na moment
    // (_pitchTorque/_rollTorque/_yawTorque) zakładają, że i ramię (r), i siła
    // (F) są wyrażone w TYM SAMYM lokalnym układzie.
    const toLocal = (v) => ({ x: v.dot(wingRight), y: v.dot(acUp), z: v.dot(noseDir) });

    const totalForce = new THREE.Vector3(0, -A321_PARAMS.mass * G_ACC, 0); // grawitacja — działa w CG, nie daje momentu
    // Kierunek "do góry" liczony względem PRĘDKOŚCI, nie względem pitchu
    // samolotu — używany dla siły nośnej skrzydła i usterzenia (patrz NAPRAWA
    // przy _computeWindUp wyżej). airspeed jest już policzony na początku
    // physicsUpdate.
    const windUp = _computeWindUp(this.vel, wingRight, acUp, airspeed);
    let torquePitch = 0, torqueRoll = 0, torqueYaw = 0;

    // ── Aerodynamika skrzydła: siła nośna + opór, jak wcześniej, ale teraz
    // przyłożona w WING_AC (blisko CG) — daje więc też niewielki moment pitch,
    // zamiast działać "w próżni" bez wpływu na obrót. ─────────────────
    const fpa = airspeed > 2 ? Math.asin(Math.max(-1, Math.min(1, this.vel.y / airspeed))) : 0;
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
    const dragVec = airspeed > 0.1 ? this.vel.clone().normalize().multiplyScalar(-dragMag) : new THREE.Vector3();
    totalForce.add(liftVec).add(dragVec);
    { const Fl = toLocal(liftVec);
      torquePitch += _pitchTorque(WING_AC, Fl);
      torqueRoll  += _rollTorque(WING_AC, Fl); }

    // ── Ciąg silników — przyłożony POD CG (THRUST_PT.y<0), więc zmiana mocy
    // silników daje (mały, ale prawdziwy) moment pitch, dokładnie jak na
    // realnym samolocie z silnikami podwieszonymi pod skrzydłami. ───────
    // throttle>=0: normalny ciąg do przodu (bez zmian względem wcześniej).
    // throttle<0: reverse thrust — ograniczony do A321_REVERSE_THRUST_FRAC
    // maksymalnego ciągu i narastający wraz z reverserDeployFrac (fizyczne
    // wysuwanie translating cowl, patrz throttle/reverser wyżej w tej funkcji).
    const thrustScale = (groundRun && this.throttle >= 0) ? A321_PARAMS.groundRunThrustBoost : 1.0;
    const thrustMagFwd = this.throttle >= 0
      ? this.throttle * A321_PARAMS.maxThrust
      : this.throttle * A321_PARAMS.maxThrust * A321_REVERSE_THRUST_FRAC * this.reverserDeployFrac;
    const thrustVec = noseDir.clone().multiplyScalar(thrustMagFwd * thrustScale);
    totalForce.add(thrustVec);
    // Moment liczymy z NIEPODBITEGO ciągu (thrustMagFwd, BEZ
    // groundRunThrustBoost) — boost naziemny to umowne wzmocnienie
    // przyspieszenia dla lepszego odczucia rozbiegu, nie prawdziwy wzrost mocy
    // silników; użycie go też tutaj sztucznie potęgowałoby "power pitch" ×2.2,
    // prowadząc do samoczynnego unoszenia przedniego koła przy większej
    // przepustnicy, bez udziału pilota (patrz NAPRAWA przy THRUST_PT).
    const thrustTorqueVec = noseDir.clone().multiplyScalar(thrustMagFwd);
    { const Ft = toLocal(thrustTorqueVec);
      torquePitch += _pitchTorque(THRUST_PT, Ft); }

    // ── Ster wysokości: PRAWDZIWA siła na usterzeniu ogonowym, zależna od
    // lokalnego kąta natarcia usterzenia i od wychylenia steru — TO ZASTĘPUJE
    // dawne bezpośrednie ustawianie pitchRate z inputu pilota. Teraz input
    // steruje POWIERZCHNIĄ (elevatorDeflection), powierzchnia wytwarza siłę
    // (tailForceVec), a siła × ramię (TAIL_AC.z, daleko za CG) daje moment,
    // który dopiero na końcu funkcji zamienia się w obrót — dokładnie jak w
    // prawdziwym samolocie.
    //
    // Lokalny kąt natarcia usterzenia = kąt natarcia skrzydła + wkład z
    // prędkości kątowej pitch: punkt na ogonie (daleko za CG) fizycznie
    // porusza się w górę/dół razem z obrotem samolotu (efekt "huśtawki" wokół
    // CG), co zmienia LOKALNY względny wiatr odczuwany przez usterzenie. To
    // jest PRAWDZIWE źródło aerodynamicznego tłumienia pitch (odpowiednik
    // współczynnika Cmq z podręczników mechaniki lotu) — wynika wprost z
    // geometrii (TAIL_AC.z), nie z żadnej wymyślonej stałej tłumienia.
    //
    // NAPRAWA (zgłoszone: "strzałka w dół robi że samolot leci w górę"): minus
    // przed pitchInput jest tu CELOWY i KONIECZNY — "ciągnięcie za drążek"
    // (pitchInput>0, strzałka w górę) musi wychylić ster tak, by usterzenie
    // wytworzyło MNIEJSZĄ/ujemną siłę (działającą w dół, za CG) — to WŁAŚNIE
    // podnosi nos (pchnięcie w dół za osią obrotu podnosi przednią część),
    // dokładnie jak wychylenie steru wysokości w górę w prawdziwym samolocie.
    // Bez tego minusa działało odwrotnie: strzałka w górę pochylała nos w dół.
    // Doliczamy też attitude hold (patrz PITCH_HOLD_KP/KD niżej) — tak jak w
    // prawdziwym samolocie, "zerowe" wychylenie steru to trym, nie zawsze
    // dosłownie zero stopni.
    const elevatorDeflection = -pitchInput * ELEVATOR_MAX_RAD + this.pitchTrim;
    // Rozdzielone na część STATYCZNĄ (kąt natarcia samolotu, mnożona przez
    // słaby TAIL_CL_ALPHA_STATIC — to "ile pitch chce wrócić do trymu sam")
    // i część RATE (wkład z prędkości kątowej pitch, mnożona przez pełny
    // TAIL_CL_ALPHA_RATE — to czyste tłumienie oscylacji, patrz NAPRAWA przy
    // TAIL_CL_ALPHA_STATIC/RATE wyżej).
    const tailAlphaStatic = alpha;
    const tailAlphaRateDamp = -(TAIL_AC.z * this.pitchRate) / Math.max(airspeed, 5);
    const tailCl = TAIL_CL_ALPHA_STATIC * tailAlphaStatic + TAIL_CL_ALPHA_RATE * tailAlphaRateDamp
                 + ELEVATOR_CL_PER_RAD * elevatorDeflection;
    const tailForceVec = windUp.clone().multiplyScalar(q * TAIL_AREA * tailCl);
    totalForce.add(tailForceVec);
    { const Ft2 = toLocal(tailForceVec);
      torquePitch += _pitchTorque(TAIL_AC, Ft2); }
    // Dodatkowe tłumienie pitch (patrz PITCH_DAMPING_GAIN) — ta sama,
    // standardowa forma co tłumienie roll niżej (q·S·L²·rate/(2V), tu z
    // długością kadłuba zamiast rozpiętości skrzydeł jako charakterystyczną
    // długością dla osi pitch).
    torquePitch -= PITCH_DAMPING_GAIN * q * A321_PARAMS.wingArea * A321_FUSELAGE_LEN * A321_FUSELAGE_LEN
                 * this.pitchRate / (2 * Math.max(airspeed, 5));

    // ── Lotki: moment przechylający wprost ze standardowego wzoru
    // aerodynamicznego (τ = q·S·rozpiętość·Cl_δa·δa) — ailerony nie mają jednego
    // "ramienia" (działają różnicowo na całej rozpiętości skrzydeł), więc
    // liczymy moment wprost zamiast punktowej siły. Plus tłumienie
    // przechylenia (odpowiednik Clp) tą samą, standardową metodą. ───────
    const aileronDeflection = rollInput * AILERON_MAX_RAD;
    torqueRoll += q * A321_PARAMS.wingArea * A321_PARAMS.span * AILERON_CL_PER_RAD * aileronDeflection;
    torqueRoll -= ROLL_DAMPING_GAIN * q * A321_PARAMS.wingArea * A321_PARAMS.span * A321_PARAMS.span
                * this.rollRate / (2 * Math.max(airspeed, 5));

    // ── Statecznik pionowy + ster kierunku: analogicznie do usterzenia
    // poziomego — prawdziwa siła boczna zależna od kąta ślizgu (beta) + wkładu
    // z yawRate (tłumienie odchylenia, ten sam mechanizm "huśtawki" co przy
    // pitch) i od wychylenia steru kierunku. Siła × ramię (FIN_AC.z) daje
    // moment yaw; FIN_AC jest dodatkowo PODNIESIONY nad oś przechylenia
    // (FIN_AC.y > 0), więc ta sama siła naturalnie sprzęga się też z rollem —
    // to prawdziwy, znany efekt uboczny sterowania kierunkiem (nie coś
    // dodanego sztucznie na siłę). ─────────────────────────────
    const beta = Math.atan2(this.vel.dot(wingRight), Math.max(airspeed, 0.5));
    // NAPRAWA (zgłoszone: "samolot sam bez controls sie buja lewo prawo w
    // locie — heading, nie roll"): wkład yawRate do finBeta musi mieć
    // PRZECIWNY znak względem tego, jak wchodzi do finForceVec, niż wkład
    // samego beta (skąd ta asymetria: kierunek "dodatniego" Cl dla statecznika
    // pionowego względem wingRight okazuje się przeciwny do kierunku "dodatniego"
    // Cl dla usterzenia poziomego względem acUp, mimo analogicznej geometrii).
    // Ze STARYM znakiem (jak dla pitch: `beta - FIN_AC.z*yawRate/V`) statyczna
    // stateczność kierunkowa (ślizg → moment przywracający) wychodziła poprawnie,
    // ale tłumienie yaw wychodziło Z PRZECIWNYM znakiem — DODATNIE sprzężenie
    // zwrotne zamiast tłumienia, czyli samopodtrzymujące/narastające kołysanie
    // w yaw bez żadnego inputu. Zweryfikowane numerycznie (Node, konkretne
    // wartości): stary wzór dawał torqueYaw=+121380 dla yawRate=+0.01·V (powinno
    // być ujemne — tłumienie), ten (z plusem) daje -121380 (poprawnie), a
    // statyczny ślizg beta=+0.1 nadal daje poprawne +71400 w OBU wersjach.
    const finBeta = beta + (FIN_AC.z * this.yawRate) / Math.max(airspeed, 5);
    const rudderDeflection = yawInput * RUDDER_MAX_RAD;
    const finCl = FIN_CL_BETA * finBeta + RUDDER_CL_PER_RAD * rudderDeflection;
    const finForceVec = wingRight.clone().multiplyScalar(-q * FIN_AREA * finCl);
    totalForce.add(finForceVec);
    { const Ff = toLocal(finForceVec);
      torqueYaw  += _yawTorque(FIN_AC, Ff);
      torqueRoll += _rollTorque(FIN_AC, Ff); }
    // Dodatkowe tłumienie yaw (patrz YAW_DAMPING_GAIN) — ta sama, standardowa
    // forma co PITCH_DAMPING_GAIN/ROLL_DAMPING_GAIN (q·S·L²·rate/(2V), tu z
    // długością kadłuba jako charakterystyczną długością dla osi yaw).
    torqueYaw -= YAW_DAMPING_GAIN * q * A321_PARAMS.wingArea * A321_FUSELAGE_LEN * A321_FUSELAGE_LEN
               * this.yawRate / (2 * Math.max(airspeed, 5));

    // ── Kontakt z ziemią: 3 niezależne punkty (przednie koło, lewe/prawe
    // główne), każdy z WŁASNĄ, w pełni fizyczną siłą sprężysto-tłumiącą
    // (wzdłuż PRAWDZIWEJ normalnej terenu — obsługuje zbocza bez osobnej
    // logiki) + siłą tarcia opony (toczenie/hamowanie + przyczepność boczna,
    // w tym skręt przedniego koła). To CAŁKOWICIE zastępuje dawne
    // settleOnGear() (które sztucznie "dociągało" pitch/roll do kąta terenu
    // przez blendowanie) — teraz kąt samolotu na ziemi jest CZYSTYM WYNIKIEM
    // momentów z tych sił, dokładnie jak w prawdziwym samolocie: jeśli
    // przednie koło naciska mocniej niż główne, to WŁAŚNIE ta różnica sił
    // (nie żaden "target kąta") obraca samolot. ───────────────────────
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
      // Twarde uderzenie (lądowanie z dużą prędkością pionową, albo wlecenie w
      // strome zbocze przy dużej prędkości) to prawdziwe zderzenie, nie zwykłe
      // osiadanie na zawieszeniu — patrz applyBounce().
      if (gearContact) bounced = this.applyBounce(gear);

      if (!bounced) {
        // Autobrake: automatyczne hamowanie kół głównych po lądowaniu, bez
        // udziału pilota. Rozłącza się gdy: pilot sam hamuje (override —
        // manualny hamulec zawsze wygrywa), dodaje moc silnika (go-around),
        // albo prędkość spadnie blisko kołowania (jak w realu).
        const autobrakeActive = this.autobrakeLevel !== 'OFF' && this.onGround
          && !input.brakes && this.throttle <= 0.05 && speedKt > AUTOBRAKE_MIN_SPEED_KT;
        const autobrakeMuRoll = TIRE_ROLLING_MU
          + (TIRE_BRAKE_MU - TIRE_ROLLING_MU) * (AUTOBRAKE_MU_FRAC[this.autobrakeLevel] ?? 0);

        for (const k of ['nose', 'left', 'right']) {
          const gp = gear[k];
          if (gp.pen < 0) continue; // koło w powietrzu — brak siły z tej goleni
          const localOff = k === 'nose' ? GEAR_NOSE : k === 'left' ? GEAR_LEFT : GEAR_RIGHT;
          const isMain = k !== 'nose';
          const kSpring = isMain ? GEAR_K_MAIN : GEAR_K_NOSE;
          const cDamp   = isMain ? GEAR_C_MAIN : GEAR_C_NOSE;

          const { lat: glat, lon: glon } = offsetGeo(this.lat, this.lon, gp.offset.x, -gp.offset.z);
          const normal = this.terrainNormalAt(glat, glon);
          // Prędkość TEGO PUNKTU (nie środka masy!) — bryła sztywna się obraca,
          // więc np. przednie koło porusza się szybciej pionowo niż CG podczas
          // rotacji. v = v_cg + ω × r.
          const vPoint = this.vel.clone().add(omegaWorld.clone().cross(gp.offset));
          const closingSpeed = -vPoint.dot(normal); // dodatnie = dalej się zagłębia w teren

          let fN = kSpring * gp.pen + cDamp * closingSpeed;
          if (gp.pen > GEAR_SUSPENSION_TRAVEL) {
            fN += kSpring * GEAR_HARDSTOP_K_MULT * (gp.pen - GEAR_SUSPENSION_TRAVEL);
          }
          fN = Math.max(0, fN); // goleń może tylko PCHAĆ, nigdy "ciągnąć" w dół

          const normalForceVec = normal.clone().multiplyScalar(fN);

          // Tarcie opony: rozkładamy prędkość punktu na składową w płaszczyźnie
          // stycznej do terenu, dalej na kierunek "toczenia" (wzdłuż samolotu)
          // i "boczny" (poślizg/skręt).
          const vTangent = vPoint.clone().sub(normal.clone().multiplyScalar(vPoint.dot(normal)));
          const noseFlat = noseDir.clone().sub(normal.clone().multiplyScalar(noseDir.dot(normal)));
          if (noseFlat.lengthSq() > 1e-6) noseFlat.normalize();
          const rightFlat = wingRight.clone().sub(normal.clone().multiplyScalar(wingRight.dot(normal)));
          if (rightFlat.lengthSq() > 1e-6) rightFlat.normalize();
          const rollSpeed = vTangent.dot(noseFlat);
          const latSpeed  = vTangent.dot(rightFlat);

          // Hamulce: TYLKO koła główne — tak jak w realnym A321, przednie koło
          // ma wyłącznie skręt (nosewheel steering), nigdy hamulec. Kolejność
          // pierwszeństwa: manualny hamulec pilota / parking brake > autobrake
          // > zwykłe tarcie toczenia.
          let muRoll = TIRE_ROLLING_MU;
          if (isMain) {
            if (input.brakes || this.parkingBrake) muRoll = TIRE_BRAKE_MU;
            else if (autobrakeActive)              muRoll = autobrakeMuRoll;
          }
          const fRoll = -Math.max(-muRoll * fN, Math.min(muRoll * fN, TIRE_LONG_STIFF * rollSpeed));

          // Tylko przednie koło ma komenderowany kąt skrętu (nosewheel
          // steering) — koła główne zawsze po prostu "trzymają się" kierunku
          // jazdy (czysta przyczepność boczna, docelowa prędkość boczna = 0).
          let latTarget = 0;
          if (k === 'nose') {
            latTarget = Math.tan(yawInput * NOSEWHEEL_MAX_RAD) * Math.max(rollSpeed, 0)
                      * groundSteerTrackFactor(speedKt);
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
      // Lądowanie na kadłubie (podwozie schowane) — uproszczony, POJEDYNCZY
      // punkt kontaktu w miejscu CG (nie 3 osobne punkty jak z wysuniętym
      // podwoziem), ale wciąż PRAWDZIWA siła sprężysto-tłumiąca, nie tylko
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

    // ── Integracja: F=ma i τ=I·α, w PEŁNI fizycznie — bez żadnych sztucznych
    // timerów oderwania, limitów pitch czy blendowania kąta do terenu. ─────
    if (!bounced) {
      const accel = totalForce.clone().divideScalar(A321_PARAMS.mass);
      this.vel.add(accel.multiplyScalar(dtCap));

      this.pitchRate += (torquePitch / A321_IYY) * dtCap;
      this.rollRate  += (torqueRoll  / A321_IXX) * dtCap;
      this.yawRate   += (torqueYaw   / A321_IZZ) * dtCap;

      // Uproszczenie kinematyczne (świadome, udokumentowane): przy umiarkowanych,
      // niesprzężonych kątach (loty liniowe, bez akrobacji) tempo zmiany kątów
      // Eulera ≈ prędkości kątowe bryły wokół własnych osi. Różnica pojawia się
      // dopiero przy dużych, jednoczesnych pitch+roll (poza normalnym zakresem
      // lotu liniowego A321) — pełne równania kinematyczne Eulera (z sin/cos/tan
      // kątów i ryzykiem "gimbal lock" przy pitch=90°) to możliwe, ale odrębne,
      // większe rozszerzenie, którego ten samolot w normalnej eksploatacji nie
      // potrzebuje.
      this.pitchRad += this.pitchRate * dtCap;
      this.rollRad  += this.rollRate  * dtCap;
      this.yawRad   += this.yawRate   * dtCap;
      // NAPRAWA: przy trafieniu na limit zerujemy TEŻ prędkość kątową (jeśli
      // dalej "pcha" w tę samą stronę) — inaczej samolot był "przyklejony" do
      // ściany limitu z rosnącym, niewidocznym "napięciem" (rate dalej rosło),
      // które potem gwałtownie się rozladowywało przy odblokowaniu.
      if (this.rollRad > 1.40) { this.rollRad = 1.40; if (this.rollRate > 0) this.rollRate = 0; }
      if (this.rollRad < -1.40) { this.rollRad = -1.40; if (this.rollRate < 0) this.rollRate = 0; }
      // Miękkie zabezpieczenie przed skrajnościami (np. błąd w innej części
      // kodu, albo naprawdę ekstremalny manewr) — to NIE jest "tail-strike cap"
      // sterujący normalnym zachowaniem: samo unikanie tail-strike wynika teraz
      // z fizyki podwozia (moment z gear force), nie z tego limitu. Na ziemi
      // zaciśnięty bardziej (margines bezpieczeństwa), w locie znacznie luźniej.
      const pitchClampMax = this.onGround ? 0.35 : 0.75;
      if (this.pitchRad > pitchClampMax) { this.pitchRad = pitchClampMax; if (this.pitchRate > 0) this.pitchRate = 0; }
      if (this.pitchRad < -0.45) { this.pitchRad = -0.45; if (this.pitchRate < 0) this.pitchRate = 0; }

      // Attitude hold: TYLKO gdy pilot nie trzyma wyraźnego inputu pitch,
      // regulator PD aktywnie utrzymuje this.pitchHoldTarget (patrz NAPRAWA v3
      // przy PITCH_HOLD_KP/KD) — zamiast tylko zerować pitchRate (co dryfowało
      // do jednego, naturalnego kąta zależnego od throttle/klap), teraz trzyma
      // DOKŁADNIE ten kąt, w którym pilot zostawił samolot. Gdy pilot trzyma
      // input, target na bieżąco podąża za aktualnym pitchem, żeby "złapać"
      // właściwy kąt w chwili puszczenia drążka.
      if (Math.abs(pitchInput) < 0.05) {
        const pitchErr = this.pitchRad - this.pitchHoldTarget; // dodatnie = pitch za wysoko względem celu
        this.pitchTrim += (PITCH_HOLD_KP * pitchErr + PITCH_HOLD_KD * this.pitchRate) * dtCap;
        this.pitchTrim = Math.max(-ELEVATOR_MAX_RAD, Math.min(ELEVATOR_MAX_RAD, this.pitchTrim));
      } else {
        this.pitchHoldTarget = this.pitchRad;
      }

      const eastVel  = this.vel.x;
      const northVel = -this.vel.z;
      const cosLat = Math.cos(Units.degToRad(this.lat));
      this.lat  += (northVel / EARTH_RADIUS) * (180 / Math.PI) * dtCap;
      this.lon  += (eastVel  / (EARTH_RADIUS * cosLat)) * (180 / Math.PI) * dtCap;
      this.altM += this.vel.y * dtCap;
    }

    if (this.vel.length() > A321_PARAMS.VMO) this.vel.setLength(A321_PARAMS.VMO);

    // ── Stan po integracji: świeża próbka podwozia z NOWEJ pozycji — do tego
    // służy onGround/agl/markery, i zabezpieczenie awaryjne przed "zamurowaniem"
    // pod terenem w jednej klatce (duża prędkość × duży dtCap, spawn, teleport). ─
    let gearFinal = gear;
    if (this.gearDown && (this.onGround || this._nearGroundZone || bounced)) {
      gearFinal = this.sampleGear(noseDir, wingRight, acUp);
      const maxPen = Math.max(gearFinal.nose.pen, gearFinal.left.pen, gearFinal.right.pen);
      if (maxPen > GEAR_EMERGENCY_PEN_M) {
        // Zabezpieczenie awaryjne — NIE normalny mechanizm gry, tylko siatka
        // bezpieczeństwa przed utknięciem pod mapą.
        const push = 1 - Math.exp(-dtCap / GEAR_EMERGENCY_SETTLE_TAU);
        this.altM += maxPen * push;
        if (this.vel.y < 0) this.vel.y *= (1 - push);
        if (window.DEBUG_GEAR) {
          console.error(`[GEAR DEBUG] AWARYJNE zanurzenie w ziemię! maxPen=${maxPen.toFixed(2)}m lat=${this.lat.toFixed(6)} lon=${this.lon.toFixed(6)} altM=${this.altM.toFixed(1)}`);
        }
      }
      this.onGround = maxPen >= 0 && !bounced;
    } else {
      this.onGround = false;
    }

    this.airspeed = this.vel.length();
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

    // DEBUG: prosty log co DEBUG_HEARTBEAT_SEC sekund, format klucz=wartość w
    // jednej linii — wystarczy skopiować kilka linii z konsoli przy zgłaszaniu
    // problemów z pitch/trymem/attitude-hold. Wyłączane przez window.DEBUG_PITCH = false.
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
          `V=${speedKt.toFixed(0)}kt vs=${this.vel.y.toFixed(1)} gnd=${this.onGround ? 1 : 0} stall=${isStalling ? 1 : 0}`
        );
      }
    }

    this._updateGearMarkers(gearFinal);
  }

  // Aktualizuje pozycję/widoczność/kolor 3 kulek-markerów kolizji podwozia
  // (patrz GEAR_MARKER_*): widoczne TYLKO gdy sampleGear() faktycznie zostało
  // policzone w tej klatce (this._nearGroundZone lub onGround — patrz gear
  // wyżej w physicsUpdate), bo tylko wtedy znamy ich rzeczywistą pozycję.
  // Pełna jasność = koło aktualnie dotyka/koliduje z terenem (pen >= 0),
  // przygaszona = w pobliżu ziemi ale jeszcze w powietrzu — daje wizualny
  // podgląd dokładnie tych samych 3 punktów, których używa silnik fizyki.
  _updateGearMarkers(gear) {
    if (!gear) {
      for (const k of ['nose', 'left', 'right']) this._gearMarkers[k].visible = false;
      return;
    }
    for (const k of ['nose', 'left', 'right']) {
      const g = gear[k];
      const marker = this._gearMarkers[k];
      marker.visible = true;
      // Pozycja w świecie: ten sam punkt geo co użyty w sampleGearPoint(), na
      // wysokości terenu w tym miejscu (a nie na wysokości koła) — tak marker
      // zawsze "leży" na ziemi, dobrze pokazując gdzie fizyka sprawdza kontakt.
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
    
    // Ster wysokości zależy bezpośrednio od wychylenia wolantu (inputu),
    // a nie od wynikowego obrotu samolotu. Max ok 25 stopni (0.43 radiana).
    const elevTarget = (typeof planeInput !== 'undefined' ? planeInput.pitch : 0) * 0.43;
    this.elevPos += (elevTarget - this.elevPos) * Math.min(1, frameDt * 10); // LERP dla płynnego ruchu hydrauliki
    
    if (p.elevatorR && p.elevatorR.userData.hingeAxis) p.elevatorR.quaternion.setFromAxisAngle(p.elevatorR.userData.hingeAxis, this.elevPos);
    if (p.elevatorL && p.elevatorL.userData.hingeAxis) p.elevatorL.quaternion.setFromAxisAngle(p.elevatorL.userData.hingeAxis, this.elevPos);

    // NAPRAWA (zgłoszone: "rudder obraca się sam"): poprzednio wizualny obrót
    // steru kierunku był ustawiany na podstawie this.yawRate — czyli
    // WYNIKOWEJ prędkości kątowej odchylenia CAŁEGO samolotu, nie wychylenia
    // pedałów pilota. Teraz gdy yaw jest napędzany prawdziwą fizyką
    // (stateczność kierunkowa, reakcje podwozia), samolot ma naturalne,
    // niewielkie korekty yaw nawet gdy pilot nic nie robi — i ster kierunku
    // "sam" się poruszał w ich takt. Tak jak elevator wyżej: ster wizualnie
    // reaguje na WYCHYLENIE PEDAŁÓW (inputu), nie na wynik ruchu samolotu.
    const rudderTarget = (typeof planeInput !== 'undefined' ? planeInput.yaw : 0) * RUDDER_MAX_RAD;
    this.rudderPos += (rudderTarget - this.rudderPos) * Math.min(1, frameDt * 10);
    if (p.rudder && p.rudder.userData.hingeAxis) {
      p.rudder.quaternion.setFromAxisAngle(p.rudder.userData.hingeAxis, this.rudderPos);
    } else if (p.rudder) {
      p.rudder.rotation.y = this.rudderPos;
    }

    this._updateShadow();
  }

  // Prawdziwy cień 3D: liczy pozycję KAŻDEGO punktu obrysu samolotu osobno
  // (nie jednej figury sztywno przeskalowanej) — obraca obrys pełną orientacją
  // samolotu, przesuwa do jego pozycji w świecie, a potem rzutuje każdy punkt
  // na teren WZDŁUŻ kierunku promieni słonecznych (z doprecyzowaniem wysokości
  // terenu w miejscu trafienia w kilku iteracjach, bo teren pod cieniem nie musi
  // być płaski — np. na zboczu albo przy krawędzi pasa). Bez Słońca nad
  // horyzontem (noc) cień jest po prostu ukryty.
  _updateShadow() {
    if (!this._shadow || !this._shadowHull) return;
    const sunDir = typeof sunWorldDir !== 'undefined' ? sunWorldDir : null;
    if (!sunDir || sunDir.y <= 0.006) {
      this._shadow.visible = false;
      return;
    }

    const outline = this._shadowHull;
    const n = outline.length;
    const planePos = this.worldPos;
    // Kierunek W KTÓRYM PADAJĄ promienie (od Słońca w dół/na zewnątrz) —
    // dokładnie przeciwny do wektora "do Słońca" używanego przez reszę sceny.
    const lightDir = _shadowLightDir.copy(sunDir).negate().normalize();
    const invLy = 1 / Math.max(-lightDir.y, 0.035); // ograniczone, żeby cień nie "uciekał" w nieskończoność tuż przy horyzoncie

    // Ta sama macierz orientacji, której używa syncMesh() (kolejność 'YXZ':
    // najpierw pitch wokół X, potem yaw wokół Y, na końcu roll wokół Z) — dzięki
    // temu cień zawsze odpowiada RZECZYWISTEJ, aktualnej pozie samolotu.
    _shadowEuler.set(-this.pitchRad, this.yawRad, this.rollRad, 'YXZ');
    _shadowQuat.setFromEuler(_shadowEuler);

    let cx = 0, cz = 0, cy = 0;

    for (let i = 0; i < n; i++) {
      const local = outline[i];
      _shadowLocalVec.set(local.x, 0, local.z).applyQuaternion(_shadowQuat);
      _shadowWorldVec.set(
        planePos.x + _shadowLocalVec.x,
        planePos.y + _shadowLocalVec.y,
        planePos.z + _shadowLocalVec.z
      );

      // Rzut wzdłuż promienia słonecznego na teren: zaczynamy od przybliżenia
      // wysokością terenu z poprzedniej klatki, potem doprecyzowujemy 2x
      // wysokością terenu FAKTYCZNIE pod punktem trafienia — wystarczająco
      // dokładne dla cienia (rzędy metrów błędu przy stromym terenie znikają po
      // 2 iteracjach), dużo tańsze niż prawdziwy raymarching przez DEM.
      let groundY = _shadowLastGroundY;
      for (let iter = 0; iter < 3; iter++) {
        const travel = (_shadowWorldVec.y - groundY) * invLy;
        _shadowHitVec.set(
          _shadowWorldVec.x + lightDir.x * travel,
          _shadowWorldVec.y + lightDir.y * travel,
          _shadowWorldVec.z + lightDir.z * travel
        );
        const geo = worldToGeo(_shadowHitVec);
        groundY = terrainHeightBest(geo.lat, geo.lon) * DEM_EXAG * Y_SCALE;
      }
      _shadowLastGroundY = groundY;

      const hitY = groundY + 0.05; // mały offset, żeby cień nie migotał (z-fighting) z terenem
      this._shadowPos[(i + 1) * 3 + 0] = _shadowHitVec.x;
      this._shadowPos[(i + 1) * 3 + 1] = hitY;
      this._shadowPos[(i + 1) * 3 + 2] = _shadowHitVec.z;
      cx += _shadowHitVec.x; cy += hitY; cz += _shadowHitVec.z;
    }

    // Centroid (indeks 0 w buforze) — środek triangulacji typu "fan".
    this._shadowPos[0] = cx / n;
    this._shadowPos[1] = cy / n;
    this._shadowPos[2] = cz / n;

    this._shadow.geometry.attributes.position.needsUpdate = true;

    // Słońce nisko nad horyzontem → kontakt cienia z ziemią jest w rzeczywistości
    // słabszy/bardziej rozmyty — lekko przyciemniamy cień przy wysokim słońcu
    // (ostry cień w południe) i rozjaśniamy przy niskim (słabszy o świcie/zmierzchu).
    const sunElevFactor = _clamp01(sunDir.y / 0.5);
    this._shadow.material.opacity = 0.20 + 0.30 * sunElevFactor;
    this._shadow.visible = true;
  }
}
