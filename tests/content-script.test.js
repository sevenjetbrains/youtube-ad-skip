const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createYouTubeDom } = require("./helpers/youtube-dom");
const { createFakeStorage } = require("./helpers/fake-storage");
require("../content/detector.js");
require("../content/ad-skipper.js");
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

function setup({ local = {}, ad = false } = {}) {
  const doc = createYouTubeDom({ ad }).window.document;
  const storage = createFakeStorage({ local });
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
  /** Simule la popup qui demande l'état de l'onglet. */
  function askStatus(sender = { id: "ext-id" }) {
    let reply;
    for (const fn of messageListeners) fn({ type: "get-status" }, sender, (r) => (reply = r));
    return reply;
  }
  return { doc, storage, sent, cs, askStatus };
}

test("activé par défaut lorsqu'aucun réglage n'est enregistré", async () => {
  const ctx = setup();
  await waitFor(() => ctx.cs.watcher.debugState.playerObserver);
  assert.equal(ctx.cs.enabled, true);
  ctx.cs.setEnabled(false);
});

test("réglage « désactivé » respecté au chargement : aucune surveillance", async () => {
  const ctx = setup({ local: { [ns.ENABLED_KEY]: false } });
  await tick(50);
  assert.equal(ctx.cs.enabled, false);
  assert.equal(ctx.cs.watcher.debugState.playerObserver, false);
});

test("désactivation pendant une publicité : surveillance arrêtée, aucun clic (scénario 6)", async () => {
  const ctx = setup({ ad: true });
  await waitFor(() => ctx.cs.watcher.debugState.adObserver);

  await ctx.storage.local.set({ [ns.ENABLED_KEY]: false }); // l'utilisateur bascule l'interrupteur
  assert.deepEqual(ctx.cs.watcher.debugState, {
    player: null,
    playerObserver: false,
    adObserver: false,
    waitObserver: false,
    polling: false,
  });

  await ctx.storage.local.set({ [ns.ENABLED_KEY]: true }); // et le réactive
  await waitFor(() => ctx.cs.watcher.debugState.adObserver);
  ctx.cs.setEnabled(false);
  assert.deepEqual(ctx.sent, [], "pub sans bouton « Ignorer » : aucun message envoyé");
});

test("répond à la popup avec l'état du lecteur", async () => {
  const ctx = setup({ ad: true });
  await waitFor(() => ctx.cs.enabled);
  assert.deepEqual(ctx.askStatus(), { enabled: true, state: "ad-waiting" });
  ctx.cs.setEnabled(false);
  assert.deepEqual(ctx.askStatus(), { enabled: false, state: "ad-waiting" });
  assert.equal(ctx.askStatus({ id: "autre-extension" }), undefined, "autre expéditeur ignoré");
});

test("publicité ignorée signalée au service worker", async () => {
  const ctx = setup();
  await waitFor(() => ctx.cs.enabled);
  ctx.cs.skipper.onSkipped();
  await waitFor(() => ctx.sent.length > 0);
  assert.deepEqual(ctx.sent, [{ type: "ad-skipped" }]);
  ctx.cs.setEnabled(false);
});
