// =============================================================================
// Tests de content/observer.js (partie surveillance : createAdWatcher)
// =============================================================================
//
// Vérifie que la surveillance réagit aux bons changements (classe du lecteur, apparition
// du bouton, navigation interne, insertion du lecteur), qu'elle regroupe les mutations
// rapprochées, et qu'elle libère TOUS ses observateurs et minuteurs quand ils ne servent
// plus (fin de publicité, arrêt). debugState expose l'état interne pour ces vérifications.
// Les MutationObserver de jsdom sont asynchrones : tick() laisse le temps de les traiter.
//
// Lancement : npm test (tous les fichiers) ou node --test tests/observer.test.js (ce fichier seul).
// Outils : node:test (exécuteur de tests intégré à Node) et node:assert/strict
// (vérifications : equal compare avec ===, deepEqual compare le contenu des objets).
// =============================================================================

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createYouTubeDom } = require("./helpers/youtube-dom");
require("../content/detector.js");
require("../content/ad-skipper.js");
const ns = require("../content/observer.js");

/** Attend quelques millisecondes : le temps que jsdom traite les mutations et les vérifications programmées. */
const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

/** Crée un faux lecteur et une surveillance qui enregistre chaque état reçu dans « states ». */
function setup(opts) {
  const dom = createYouTubeDom(opts);
  const doc = dom.window.document;
  const states = [];
  const watcher = ns.createAdWatcher({ doc, onCheck: (info) => states.push(info.state) });
  return { dom, doc, states, watcher, last: () => states[states.length - 1] };
}

test("vérification initiale au démarrage, sans observation de pub (scénario 1)", async () => {
  const ctx = setup({ ad: false });
  ctx.watcher.start();
  await tick();
  assert.equal(ctx.last(), "no-ad");
  assert.deepEqual(
    { ...ctx.watcher.debugState, player: !!ctx.watcher.debugState.player },
    { player: true, playerObserver: true, adObserver: false, waitObserver: false, polling: false }
  );
  ctx.watcher.stop();
});

test("début et fin de publicité détectés par la classe du lecteur", async () => {
  const ctx = setup({ ad: false });
  ctx.watcher.start();
  await tick();
  const player = ctx.doc.getElementById("movie_player");

  player.classList.add("ad-showing");
  await tick();
  assert.equal(ctx.last(), "ad-waiting");
  assert.equal(ctx.watcher.debugState.adObserver, true);
  assert.equal(ctx.watcher.debugState.polling, true);

  player.classList.remove("ad-showing");
  await tick();
  assert.equal(ctx.last(), "no-ad");
  assert.equal(ctx.watcher.debugState.adObserver, false, "observateur de pub libéré");
  assert.equal(ctx.watcher.debugState.polling, false, "minuteur libéré");
  ctx.watcher.stop();
});

test("apparition du bouton « Ignorer » pendant la publicité (scénario 3)", async () => {
  const ctx = setup({ ad: true, skipClass: "ytp-skip-ad-button", skipVisible: false });
  ctx.watcher.start();
  await tick();
  assert.equal(ctx.last(), "ad-waiting");
  ctx.doc.querySelector(".ytp-skip-ad-button").style.display = "";
  await tick();
  assert.equal(ctx.last(), "ad-skippable");
  ctx.watcher.stop();
});

test("lecteur absent puis inséré (navigation depuis l'accueil, scénario 7)", async () => {
  const ctx = setup({ player: false });
  ctx.watcher.start();
  await tick();
  assert.equal(ctx.last(), "no-player");
  assert.equal(ctx.watcher.debugState.waitObserver, true);

  const player = ctx.doc.createElement("div");
  player.id = "movie_player";
  player.className = "html5-video-player ad-showing";
  ctx.doc.body.appendChild(player);
  await tick();
  assert.equal(ctx.last(), "ad-waiting");
  assert.equal(ctx.watcher.debugState.waitObserver, false, "observateur d'attente libéré");
  ctx.watcher.stop();
});

test("l'événement yt-navigate-finish déclenche une vérification (scénario 7)", async () => {
  const ctx = setup({ ad: false });
  ctx.watcher.start();
  await tick();
  const before = ctx.states.length;
  ctx.doc.dispatchEvent(new ctx.dom.window.Event("yt-navigate-finish", { bubbles: true }));
  await tick();
  assert.equal(ctx.states.length, before + 1);
  ctx.watcher.stop();
});

test("plusieurs mutations rapprochées : une seule vérification", async () => {
  const ctx = setup({ ad: false });
  ctx.watcher.start();
  await tick();
  const before = ctx.states.length;
  const player = ctx.doc.getElementById("movie_player");
  player.classList.add("a");
  player.classList.add("b");
  player.classList.add("c");
  await tick();
  assert.equal(ctx.states.length, before + 1);
  ctx.watcher.stop();
});

test("stop() libère tout et ignore les changements suivants (scénario 6)", async () => {
  const ctx = setup({ ad: true });
  ctx.watcher.start();
  await tick();
  ctx.watcher.stop();
  assert.deepEqual(ctx.watcher.debugState, {
    player: null,
    playerObserver: false,
    adObserver: false,
    waitObserver: false,
    polling: false,
  });
  const before = ctx.states.length;
  ctx.doc.getElementById("movie_player").classList.remove("ad-showing");
  ctx.doc.dispatchEvent(new ctx.dom.window.Event("yt-navigate-finish"));
  await tick();
  assert.equal(ctx.states.length, before);
});

test("une erreur dans le traitement n'arrête pas la surveillance (scénario 10)", async () => {
  const dom = createYouTubeDom({ ad: false });
  const doc = dom.window.document;
  let calls = 0;
  const watcher = ns.createAdWatcher({
    doc,
    onCheck: () => {
      calls++;
      throw new Error("panne simulée");
    },
  });
  const warn = console.warn;
  console.warn = () => {};
  try {
    watcher.start();
    await tick();
    doc.getElementById("movie_player").classList.add("ad-showing");
    await tick();
  } finally {
    console.warn = warn;
    watcher.stop();
  }
  assert.equal(calls, 2);
});
