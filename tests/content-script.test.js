// =============================================================================
// Tests de content/observer.js (partie démarrage : startContentScript)
// =============================================================================
//
// Vérifie le lien entre la surveillance, les réglages et le reste de l'extension :
// application des réglages au chargement et en pleine lecture, conservation après
// redémarrage, fonction expérimentale, réponse à la popup, signalement des publicités
// ignorées, arrêt propre quand l'extension est rechargée sans recharger l'onglet.
// L'API chrome est entièrement simulée (faux runtime + helpers/fake-storage.js).
// waitFor() attend une condition plutôt qu'un délai fixe : les tests restent fiables
// même quand Node les exécute en parallèle sur une machine chargée.
//
// Lancement : npm test (tous les fichiers) ou node --test tests/content-script.test.js (ce fichier seul).
// Outils : node:test (exécuteur de tests intégré à Node) et node:assert/strict
// (vérifications : equal compare avec ===, deepEqual compare le contenu des objets).
// =============================================================================

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createYouTubeDom } = require("./helpers/youtube-dom");
const { createFakeStorage } = require("./helpers/fake-storage");
const Settings = require("../common/settings.js");
require("../content/detector.js");
require("../content/ad-skipper.js");
require("../content/ad-accelerator.js");
const ns = require("../content/observer.js");

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

/** Attend qu'une condition soit vraie (les tests tournent en parallèle et peuvent être lents). */
async function waitFor(condition, timeoutMs = 2000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("condition non atteinte");
    await tick();
  }
}

/** Réglages qui arrêtent tout : utilisés en fin de test pour libérer observateurs et minuteurs. */
const OFF = { enabled: false, autoSkip: false, experimental: false };

/**
 * Démarre le content script sur un faux lecteur, avec une fausse API chrome.
 * @param {object} [opts]
 * @param {object} [opts.local] réglages déjà enregistrés dans chrome.storage.local
 * @param {boolean} [opts.ad] publicité en cours au démarrage
 * @param {object} [opts.storage] stockage partagé (pour simuler un redémarrage)
 */
function setup({ local = {}, ad = false, storage = createFakeStorage({ local }) } = {}) {
  const doc = createYouTubeDom({ ad }).window.document;
  const sent = [];
  const messageListeners = [];
  const chromeApi = {
    runtime: {
      id: "ext-id",
      async sendMessage(message) {
        sent.push(message);
        return { ok: true };
      },
      onMessage: { addListener: (fn) => messageListeners.push(fn) },
    },
    storage,
  };
  const cs = ns.startContentScript({ doc, chromeApi });
  cs.chromeApi = chromeApi; // accès pour les tests
  /** Simule la popup qui demande l'état de l'onglet. */
  function askStatus(sender = { id: "ext-id" }) {
    let reply;
    for (const fn of messageListeners) fn({ type: "get-status" }, sender, (r) => (reply = r));
    return reply;
  }
  const video = doc.querySelector("video");
  return { doc, video, storage, sent, cs, askStatus, stop: () => cs.applySettings(OFF) };
}

test("réglages par défaut lorsqu'aucun n'est enregistré : clic automatique seul", async () => {
  const ctx = setup();
  await waitFor(() => ctx.cs.watcher.debugState.playerObserver);
  assert.deepEqual(ctx.cs.settings, Settings.DEFAULT_SETTINGS);
  ctx.stop();
});

test("extension désactivée au chargement : aucune surveillance", async () => {
  const ctx = setup({ local: { enabled: false } });
  await waitFor(() => ctx.cs.settings);
  assert.equal(ctx.cs.enabled, false);
  assert.equal(ctx.cs.watcher.debugState.playerObserver, false);
});

test("clic automatique et expérimental désactivés : aucune surveillance", async () => {
  const ctx = setup({ local: { autoSkip: false, experimental: false } });
  await waitFor(() => ctx.cs.settings);
  assert.equal(ctx.cs.watcher.debugState.playerObserver, false);
});

test("réglages conservés après un redémarrage de Chrome (scénario 8)", async () => {
  const storage = createFakeStorage(); // chrome.storage.local survit au redémarrage
  const before = setup({ storage });
  await waitFor(() => before.cs.settings);
  await storage.local.set({ autoSkip: false, experimental: true }); // choix faits dans les options
  before.stop(); // fermeture de l'onglet

  const after = setup({ storage }); // nouvel onglet après redémarrage
  await waitFor(() => after.cs.settings);
  assert.deepEqual(after.cs.settings, { enabled: true, autoSkip: false, experimental: true });
  after.stop();
});

test("désactivation pendant une publicité : surveillance arrêtée, aucun clic (scénario 6)", async () => {
  const ctx = setup({ ad: true });
  await waitFor(() => ctx.cs.watcher.debugState.adObserver);

  await ctx.storage.local.set({ enabled: false }); // l'utilisateur bascule l'interrupteur
  assert.deepEqual(ctx.cs.watcher.debugState, {
    player: null,
    playerObserver: false,
    adObserver: false,
    waitObserver: false,
    polling: false,
  });

  await ctx.storage.local.set({ enabled: true }); // et le réactive
  await waitFor(() => ctx.cs.watcher.debugState.adObserver);
  ctx.stop();
  assert.deepEqual(ctx.sent, [], "pub sans bouton « Ignorer » : aucun message envoyé");
});

test("expérimental désactivé (défaut) : la vitesse des publicités n'est pas touchée", async () => {
  const ctx = setup({ ad: true });
  await waitFor(() => ctx.cs.watcher.debugState.adObserver);
  await tick(20);
  assert.equal(ctx.video.playbackRate, 1);
  assert.equal(ctx.video.muted, false);
  ctx.stop();
});

test("expérimental activé en pleine publicité puis désactivé : vitesse et son rétablis", async () => {
  const ctx = setup({ ad: true });
  await waitFor(() => ctx.cs.watcher.debugState.adObserver);
  await ctx.storage.local.set({ experimental: true });
  await waitFor(() => ctx.video.playbackRate === ns.AD_PLAYBACK_RATE); // vérification de secours (500 ms)
  assert.equal(ctx.video.muted, true);

  await ctx.storage.local.set({ experimental: false });
  assert.equal(ctx.video.playbackRate, 1);
  assert.equal(ctx.video.muted, false);
  ctx.stop();
});

test("fin de publicité avec expérimental : vidéo rétablie", async () => {
  const ctx = setup({ ad: true, local: { experimental: true } });
  await waitFor(() => ctx.video.playbackRate === ns.AD_PLAYBACK_RATE);
  ctx.doc.getElementById("movie_player").classList.remove("ad-showing", "ad-interrupting");
  await waitFor(() => ctx.video.playbackRate === 1);
  assert.equal(ctx.video.muted, false);
  ctx.stop();
});

test("répond à la popup avec l'état du lecteur", async () => {
  const ctx = setup({ ad: true });
  await waitFor(() => ctx.cs.enabled);
  assert.deepEqual(ctx.askStatus(), { enabled: true, state: "ad-waiting" });
  ctx.stop();
  assert.deepEqual(ctx.askStatus(), { enabled: false, state: "ad-waiting" });
  assert.equal(ctx.askStatus({ id: "autre-extension" }), undefined, "autre expéditeur ignoré");
});

test("publicité ignorée signalée au service worker", async () => {
  const ctx = setup();
  await waitFor(() => ctx.cs.enabled);
  ctx.cs.skipper.onSkipped();
  await waitFor(() => ctx.sent.length > 0);
  assert.deepEqual(ctx.sent, [{ type: "ad-skipped" }]);
  ctx.stop();
});

test("extension rechargée sans recharger l'onglet : arrêt propre et vidéo rétablie", async () => {
  const ctx = setup({ ad: true, local: { experimental: true } });
  await waitFor(() => ctx.video.playbackRate === ns.AD_PLAYBACK_RATE);

  ctx.cs.chromeApi.runtime.id = undefined; // ce que fait Chrome quand le contexte est invalidé
  await waitFor(() => !ctx.cs.enabled); // détecté à la vérification suivante (≤ 500 ms)
  assert.equal(ctx.video.playbackRate, 1);
  assert.equal(ctx.video.muted, false);
  assert.equal(ctx.cs.watcher.debugState.adObserver, false);
  assert.equal(ctx.cs.watcher.debugState.polling, false);
  assert.deepEqual(ctx.sent, [], "aucun clic tenté");
});

test("lecteur sans conteneur .video-ads (interface modifiée, scénario 9) : surveillance sans erreur", async () => {
  const ctx = setup({ ad: true });
  ctx.doc.querySelector(".video-ads").remove();
  await waitFor(() => ctx.cs.watcher.debugState.adObserver); // repli sur le lecteur entier
  assert.deepEqual(ctx.askStatus(), { enabled: true, state: "ad-waiting" });
  ctx.stop();
});
