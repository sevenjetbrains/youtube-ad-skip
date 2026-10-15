// Service worker : envoie les vrais clics sur le bouton « Ignorer » via chrome.debugger
// et tient les statistiques (seul écrivain, pour que plusieurs onglets ne se marchent pas dessus).
//
// Pourquoi chrome.debugger ? Le lecteur YouTube rejette les clics dont event.isTrusted
// vaut false (voir docs/verification-selecteurs.md). Un content script ne peut produire
// que ce type de clic ; Input.dispatchMouseEvent du protocole DevTools produit un clic réel.
//
// Le clic se fait en deux temps, à la demande du content script :
//   1. « debugger-attach » : attache le débogueur. Chrome affiche alors son bandeau
//      « … a commencé à déboguer ce navigateur », ce qui peut décaler la mise en page ;
//   2. « debugger-click » : le content script a recalculé la position du bouton après
//      ce décalage ; le clic est envoyé puis le débogueur détaché immédiatement.
// Un délai de sécurité détache le débogueur si l'étape 2 n'arrive jamais.

const DEBUGGER_PROTOCOL_VERSION = "1.3";
const ATTACH_TIMEOUT_MS = 3000;
const ALLOWED_ORIGIN = "https://www.youtube.com/";

// Statistiques : la session est effacée par Chrome à sa fermeture, le total est conservé.
const SESSION_COUNT_KEY = "sessionSkipped";
const TOTAL_COUNT_KEY = "totalSkipped";

/** Messages acceptés et expéditeur requis pour chacun. */
const CONTENT_MESSAGES = new Set(["debugger-attach", "debugger-click", "debugger-detach", "ad-skipped"]);
const EXTENSION_PAGE_MESSAGES = new Set(["stats-reset"]);

/** Onglets auxquels l'extension est attachée : tabId -> minuteur de détachement automatique. */
const attachedTabs = new Map();

/** Vrai si le message vient de notre content script, dans le cadre principal d'un onglet YouTube. */
function isTrustedSender(sender) {
  return Boolean(
    sender &&
      sender.id === chrome.runtime.id &&
      sender.tab &&
      Number.isInteger(sender.tab.id) &&
      sender.frameId === 0 &&
      typeof sender.url === "string" &&
      sender.url.startsWith(ALLOWED_ORIGIN)
  );
}

/** Vrai si le message vient d'une page de l'extension (popup, aide). */
function isExtensionPage(sender) {
  return Boolean(
    sender &&
      sender.id === chrome.runtime.id &&
      typeof sender.url === "string" &&
      sender.url.startsWith(chrome.runtime.getURL(""))
  );
}

function isAuthorized(message, sender) {
  if (CONTENT_MESSAGES.has(message.type)) return isTrustedSender(sender);
  if (EXTENSION_PAGE_MESSAGES.has(message.type)) return isExtensionPage(sender);
  return false;
}

// Les écritures sont mises en file : deux incréments simultanés ne doivent pas se perdre.
let statsQueue = Promise.resolve();

function enqueueStatsUpdate(update) {
  const run = statsQueue.then(update);
  statsQueue = run.catch(() => {});
  return run;
}

function recordSkippedAd() {
  return enqueueStatsUpdate(async () => {
    const [session, local] = await Promise.all([
      chrome.storage.session.get({ [SESSION_COUNT_KEY]: 0 }),
      chrome.storage.local.get({ [TOTAL_COUNT_KEY]: 0 }),
    ]);
    await Promise.all([
      chrome.storage.session.set({ [SESSION_COUNT_KEY]: session[SESSION_COUNT_KEY] + 1 }),
      chrome.storage.local.set({ [TOTAL_COUNT_KEY]: local[TOTAL_COUNT_KEY] + 1 }),
    ]);
  });
}

function resetStats() {
  return enqueueStatsUpdate(() =>
    Promise.all([
      chrome.storage.session.set({ [SESSION_COUNT_KEY]: 0 }),
      chrome.storage.local.set({ [TOTAL_COUNT_KEY]: 0 }),
    ])
  );
}

function isValidPoint(x, y) {
  return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0;
}

async function attachDebugger(tabId) {
  if (attachedTabs.has(tabId)) return;
  await chrome.debugger.attach({ tabId }, DEBUGGER_PROTOCOL_VERSION);
  attachedTabs.set(
    tabId,
    setTimeout(() => detachDebugger(tabId), ATTACH_TIMEOUT_MS)
  );
}

async function detachDebugger(tabId) {
  const timer = attachedTabs.get(tabId);
  if (timer === undefined) return;
  clearTimeout(timer);
  attachedTabs.delete(tabId);
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    // Déjà détaché (onglet fermé, bandeau « Annuler » cliqué…) : rien à faire.
  }
}

/** Envoie un clic gauche réel aux coordonnées données (pixels CSS, relatives à la fenêtre). */
async function dispatchTrustedClick(tabId, x, y) {
  if (!attachedTabs.has(tabId)) throw new Error("débogueur non attaché");
  try {
    const event = { x, y, button: "left", clickCount: 1 };
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", { ...event, type: "mousePressed" });
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", { ...event, type: "mouseReleased" });
  } finally {
    await detachDebugger(tabId);
  }
}

async function handleMessage(message, sender) {
  const tabId = sender.tab && sender.tab.id;
  switch (message.type) {
    case "debugger-attach":
      await attachDebugger(tabId);
      return { ok: true };
    case "debugger-click":
      if (!isValidPoint(message.x, message.y)) {
        await detachDebugger(tabId);
        return { ok: false, error: "coordonnées invalides" };
      }
      await dispatchTrustedClick(tabId, message.x, message.y);
      return { ok: true };
    case "debugger-detach":
      await detachDebugger(tabId);
      return { ok: true };
    case "ad-skipped":
      await recordSkippedAd();
      return { ok: true };
    case "stats-reset":
      await resetStats();
      return { ok: true };
    default:
      return undefined;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") return false;
  if (!CONTENT_MESSAGES.has(message.type) && !EXTENSION_PAGE_MESSAGES.has(message.type)) return false;
  if (!isAuthorized(message, sender)) {
    sendResponse({ ok: false, error: "expéditeur non autorisé" });
    return false;
  }
  handleMessage(message, sender).then(sendResponse, (error) =>
    sendResponse({ ok: false, error: String((error && error.message) || error) })
  );
  return true; // réponse asynchrone
});

// Détachement par Chrome (onglet fermé, bouton « Annuler » du bandeau) : oublier l'onglet.
chrome.debugger.onDetach.addListener((source) => {
  const timer = attachedTabs.get(source.tabId);
  if (timer !== undefined) {
    clearTimeout(timer);
    attachedTabs.delete(source.tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => detachDebugger(tabId));

// Export pour les tests Node (absent dans Chrome).
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    isTrustedSender,
    isExtensionPage,
    isAuthorized,
    isValidPoint,
    handleMessage,
    attachedTabs,
    ATTACH_TIMEOUT_MS,
    SESSION_COUNT_KEY,
    TOTAL_COUNT_KEY,
  };
}
