const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { createFakeStorage } = require("./helpers/fake-storage");

// Fausse API chrome minimale, installée avant le chargement du service worker.
const calls = [];
let attachError = null;
const storage = createFakeStorage();
globalThis.chrome = {
  runtime: {
    id: "ext-id",
    getURL: (path) => "chrome-extension://ext-id/" + path,
    onMessage: { addListener() {} },
  },
  storage,
  tabs: { onRemoved: { addListener() {} } },
  debugger: {
    onDetach: { addListener() {} },
    async attach(target, version) {
      calls.push(["attach", target.tabId, version]);
      if (attachError) throw new Error(attachError);
    },
    async detach(target) {
      calls.push(["detach", target.tabId]);
    },
    async sendCommand(target, method, params) {
      calls.push(["command", target.tabId, method, params.type, params.x, params.y]);
    },
  },
};
const bg = require("../background.js");

const youtubeSender = { id: "ext-id", tab: { id: 7 }, frameId: 0, url: "https://www.youtube.com/watch?v=x" };
const popupSender = { id: "ext-id", url: "chrome-extension://ext-id/popup/popup.html" };

beforeEach(async () => {
  for (const tabId of [...bg.attachedTabs.keys()]) await bg.handleMessage({ type: "debugger-detach" }, { tab: { id: tabId } });
  calls.length = 0;
  attachError = null;
  for (const area of [storage.local, storage.session]) for (const key of Object.keys(area.data)) delete area.data[key];
});

test("n'accepte que notre content script dans le cadre principal YouTube", () => {
  assert.equal(bg.isTrustedSender(youtubeSender), true);
  assert.equal(bg.isTrustedSender({ ...youtubeSender, id: "autre-extension" }), false);
  assert.equal(bg.isTrustedSender({ ...youtubeSender, frameId: 3 }), false);
  assert.equal(bg.isTrustedSender({ ...youtubeSender, url: "https://www.youtube.com.evil.test/" }), false);
  assert.equal(bg.isTrustedSender({ ...youtubeSender, url: "https://m.youtube.com/watch" }), false);
  assert.equal(bg.isTrustedSender({ ...youtubeSender, tab: undefined }), false);
});

test("attache, clic gauche réel (appui + relâchement), puis détache", async () => {
  assert.deepEqual(await bg.handleMessage({ type: "debugger-attach" }, youtubeSender), { ok: true });
  assert.deepEqual(await bg.handleMessage({ type: "debugger-click", x: 960, y: 520 }, youtubeSender), { ok: true });
  assert.deepEqual(calls, [
    ["attach", 7, "1.3"],
    ["command", 7, "Input.dispatchMouseEvent", "mousePressed", 960, 520],
    ["command", 7, "Input.dispatchMouseEvent", "mouseReleased", 960, 520],
    ["detach", 7],
  ]);
  assert.equal(bg.attachedTabs.size, 0);
});

test("refuse de cliquer sans attachement préalable", async () => {
  await assert.rejects(bg.handleMessage({ type: "debugger-click", x: 1, y: 1 }, youtubeSender), /non attaché/);
  assert.deepEqual(calls, []);
});

test("coordonnées invalides : pas de clic, débogueur détaché", async () => {
  await bg.handleMessage({ type: "debugger-attach" }, youtubeSender);
  const reply = await bg.handleMessage({ type: "debugger-click", x: NaN, y: 5 }, youtubeSender);
  assert.equal(reply.ok, false);
  assert.deepEqual(calls.map((c) => c[0]), ["attach", "detach"]);
});

test("échec d'attachement remonté au content script", async () => {
  attachError = "Another debugger is already attached to the tab";
  await assert.rejects(bg.handleMessage({ type: "debugger-attach" }, youtubeSender), /already attached/);
  assert.equal(bg.attachedTabs.size, 0);
});

test("détachement automatique si le clic n'arrive jamais", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  await bg.handleMessage({ type: "debugger-attach" }, youtubeSender);
  t.mock.timers.tick(bg.ATTACH_TIMEOUT_MS);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.map((c) => c[0]), ["attach", "detach"]);
  assert.equal(bg.attachedTabs.size, 0);
});

test("types de message inconnus ignorés", async () => {
  assert.equal(await bg.handleMessage({ type: "autre" }, youtubeSender), undefined);
});

test("chaque publicité ignorée incrémente la session et le total", async () => {
  storage.local.data[bg.TOTAL_COUNT_KEY] = 10; // total d'une session précédente
  await bg.handleMessage({ type: "ad-skipped" }, youtubeSender);
  await bg.handleMessage({ type: "ad-skipped" }, youtubeSender);
  assert.equal(storage.session.data[bg.SESSION_COUNT_KEY], 2);
  assert.equal(storage.local.data[bg.TOTAL_COUNT_KEY], 12);
});

test("incréments simultanés (plusieurs onglets) : aucun n'est perdu", async () => {
  await Promise.all(Array.from({ length: 5 }, () => bg.handleMessage({ type: "ad-skipped" }, youtubeSender)));
  assert.equal(storage.session.data[bg.SESSION_COUNT_KEY], 5);
  assert.equal(storage.local.data[bg.TOTAL_COUNT_KEY], 5);
});

test("réinitialisation des deux compteurs", async () => {
  await bg.handleMessage({ type: "ad-skipped" }, youtubeSender);
  await bg.handleMessage({ type: "stats-reset" }, popupSender);
  assert.equal(storage.session.data[bg.SESSION_COUNT_KEY], 0);
  assert.equal(storage.local.data[bg.TOTAL_COUNT_KEY], 0);
});

test("chaque message n'est accepté que de son expéditeur prévu", () => {
  assert.equal(bg.isAuthorized({ type: "ad-skipped" }, youtubeSender), true);
  assert.equal(bg.isAuthorized({ type: "ad-skipped" }, popupSender), false);
  assert.equal(bg.isAuthorized({ type: "stats-reset" }, popupSender), true);
  assert.equal(bg.isAuthorized({ type: "stats-reset" }, youtubeSender), false, "une page web ne peut pas effacer les stats");
  assert.equal(bg.isAuthorized({ type: "stats-reset" }, { ...popupSender, id: "autre" }), false);
  assert.equal(bg.isAuthorized({ type: "debugger-attach" }, popupSender), false);
});
