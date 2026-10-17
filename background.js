// =============================================================================
// background.js — service worker de l'extension (Manifest V3)
// =============================================================================
//
// Rôle :
//   1. Envoyer les VRAIS clics sur le bouton « Ignorer » des publicités, via chrome.debugger.
//   2. Tenir les statistiques (publicités ignorées pendant la session et au total).
//   3. Enregistrer le blocage et le masquage des publicités selon les réglages.
//
// Un service worker MV3 n'a pas accès à la page : il ne voit ni le DOM ni le lecteur.
// C'est le content script (content/*.js) qui détecte la publicité et calcule la position
// du bouton ; il demande ensuite au service worker de cliquer à ces coordonnées.
//
// Pourquoi chrome.debugger ?
//   Le lecteur YouTube rejette les clics dont event.isTrusted vaut false (voir
//   docs/verification-selecteurs.md). Tout clic produit par un script de page ou par un
//   content script (element.click(), dispatchEvent…) a isTrusted === false : il ne fait pas
//   passer la publicité et déclenche même « onAbnormalityDetected » côté YouTube.
//   La commande Input.dispatchMouseEvent du protocole DevTools, accessible aux extensions
//   par chrome.debugger, produit au contraire un clic que le navigateur traite comme un
//   clic réel de l'utilisateur (isTrusted === true).
//
// Le clic se fait en deux temps, à la demande du content script :
//   1. « debugger-attach » : attache le débogueur à l'onglet. Chrome affiche alors son
//      bandeau « … a commencé à déboguer ce navigateur », ce qui peut décaler la page de
//      quelques pixels vers le bas ;
//   2. « debugger-click » : le content script a recalculé la position du bouton APRÈS ce
//      décalage ; le clic est envoyé à ces coordonnées puis le débogueur est détaché aussitôt.
//   Un délai de sécurité (ATTACH_TIMEOUT_MS) détache le débogueur si l'étape 2 n'arrive
//   jamais (onglet fermé, publicité terminée entre-temps, erreur dans le content script…).
//
// Blocage et masquage des publicités (réglages « blockAds » et « hideAds ») :
//   content/ad-blocker.js doit s'exécuter dans la page elle-même (monde MAIN) et avant les
//   scripts de YouTube (document_start). Dans ce monde, chrome.storage n'est pas accessible :
//   le script ne peut pas lire ses réglages. C'est donc ce fichier qui l'enregistre auprès de
//   Chrome (chrome.scripting.registerContentScripts) quand le réglage est activé, et le
//   retire sinon. Même chose pour content/ad-hider.css. Un changement de réglage prend
//   effet au prochain chargement des pages YouTube.
//
// Statistiques :
//   Ce fichier est le SEUL à écrire les compteurs. Si chaque onglet écrivait lui-même,
//   deux onglets qui ignorent une publicité au même moment pourraient lire la même valeur
//   et écrire chacun « valeur + 1 » : un incrément serait perdu. Ici, les écritures passent
//   par une file d'attente et s'exécutent l'une après l'autre.
// =============================================================================

// --- Réglages ----------------------------------------------------------------

// Module common/settings.js. Dans Chrome, importScripts le charge dans le service worker
// (qui n'est pas un module ES) ; dans les tests Node, require le fournit.
const Settings =
  typeof importScripts === "function"
    ? (importScripts("common/settings.js"), globalThis.YtAdSkipSettings)
    : require("./common/settings.js");

// --- Constantes --------------------------------------------------------------

/** Version du protocole DevTools demandée à chrome.debugger.attach (1.3 = version stable). */
const DEBUGGER_PROTOCOL_VERSION = "1.3";

/** Délai maximal (ms) pendant lequel le débogueur peut rester attaché sans recevoir de clic. */
const ATTACH_TIMEOUT_MS = 3000;

/** Seule origine autorisée à demander un clic (l'extension ne couvre que www.youtube.com). */
const ALLOWED_ORIGIN = "https://www.youtube.com/";

// Clés des compteurs dans chrome.storage :
//   - sessionSkipped est rangé dans chrome.storage.session, que Chrome vide à sa fermeture ;
//   - totalSkipped est rangé dans chrome.storage.local, conservé entre les redémarrages.
const SESSION_COUNT_KEY = "sessionSkipped";
const TOTAL_COUNT_KEY = "totalSkipped";

// Liste blanche des messages acceptés, classés selon l'expéditeur qui a le droit de les
// envoyer. Tout autre type de message est ignoré par l'écouteur plus bas.
/** Messages envoyés par le content script d'un onglet YouTube. */
const CONTENT_MESSAGES = new Set(["debugger-attach", "debugger-click", "debugger-detach", "ad-skipped"]);
/** Messages envoyés par une page de l'extension (popup). */
const EXTENSION_PAGE_MESSAGES = new Set(["stats-reset"]);

// --- État en mémoire ---------------------------------------------------------

/**
 * Onglets auxquels l'extension est actuellement attachée comme débogueur.
 * Clé : identifiant de l'onglet (tabId). Valeur : minuteur de détachement automatique.
 *
 * Remarque : un service worker MV3 peut être arrêté par Chrome quand il est inactif ;
 * cette Map est alors perdue. Le risque est faible : entre l'attachement et le détachement,
 * il ne s'écoule qu'une fraction de seconde, pendant laquelle le worker traite des messages.
 */
const attachedTabs = new Map();

// --- Contrôle des expéditeurs ------------------------------------------------

/**
 * Vrai si le message vient de NOTRE content script, dans le cadre principal (frameId 0)
 * d'un onglet www.youtube.com.
 *
 * Ce contrôle empêche :
 *   - une autre extension de nous faire cliquer (sender.id différent) ;
 *   - un cadre intégré (iframe) de la page de demander un clic (frameId ≠ 0) ;
 *   - un domaine trompeur comme « www.youtube.com.exemple.test » (startsWith sur
 *     l'origine complète, barre oblique finale comprise).
 * @param {chrome.runtime.MessageSender} sender expéditeur fourni par Chrome
 */
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

/**
 * Vrai si le message vient d'une page de l'extension (popup, options, aide).
 * Ces pages ont une adresse chrome-extension://<id-de-l'extension>/…
 * @param {chrome.runtime.MessageSender} sender
 */
function isExtensionPage(sender) {
  return Boolean(
    sender &&
      sender.id === chrome.runtime.id &&
      typeof sender.url === "string" &&
      sender.url.startsWith(chrome.runtime.getURL(""))
  );
}

/**
 * Vrai si cet expéditeur a le droit d'envoyer ce type de message.
 * Une page YouTube ne peut pas remettre les statistiques à zéro, et la popup ne peut pas
 * demander de clic.
 */
function isAuthorized(message, sender) {
  if (CONTENT_MESSAGES.has(message.type)) return isTrustedSender(sender);
  if (EXTENSION_PAGE_MESSAGES.has(message.type)) return isExtensionPage(sender);
  return false;
}

// --- Statistiques ------------------------------------------------------------

// File d'attente des écritures : chaque mise à jour attend la fin de la précédente.
// statsQueue est toujours une promesse résolue (jamais rejetée), pour qu'une écriture
// en échec ne bloque pas les suivantes.
let statsQueue = Promise.resolve();

/**
 * Ajoute une mise à jour des compteurs à la file d'attente.
 * @param {() => Promise<unknown>} update fonction qui lit puis écrit les compteurs
 * @returns {Promise<unknown>} promesse de CETTE mise à jour (rejetée si elle échoue)
 */
function enqueueStatsUpdate(update) {
  const run = statsQueue.then(update);
  statsQueue = run.catch(() => {}); // la file continue même si cette mise à jour échoue
  return run;
}

/** Ajoute 1 au compteur de session et au compteur total. */
function recordSkippedAd() {
  return enqueueStatsUpdate(async () => {
    // Lecture des deux compteurs en parallèle ; 0 si la clé n'existe pas encore.
    const [session, local] = await Promise.all([
      chrome.storage.session.get({ [SESSION_COUNT_KEY]: 0 }),
      chrome.storage.local.get({ [TOTAL_COUNT_KEY]: 0 }),
    ]);
    // Écriture des deux nouvelles valeurs. chrome.storage.onChanged prévient ensuite la
    // popup, qui met son affichage à jour si elle est ouverte.
    await Promise.all([
      chrome.storage.session.set({ [SESSION_COUNT_KEY]: session[SESSION_COUNT_KEY] + 1 }),
      chrome.storage.local.set({ [TOTAL_COUNT_KEY]: local[TOTAL_COUNT_KEY] + 1 }),
    ]);
  });
}

/** Remet les deux compteurs à zéro (bouton « Réinitialiser les statistiques » de la popup). */
function resetStats() {
  return enqueueStatsUpdate(() =>
    Promise.all([
      chrome.storage.session.set({ [SESSION_COUNT_KEY]: 0 }),
      chrome.storage.local.set({ [TOTAL_COUNT_KEY]: 0 }),
    ])
  );
}

// --- Débogueur et clic -------------------------------------------------------

/**
 * Vrai si (x, y) est un point utilisable : deux nombres finis et positifs.
 * Les coordonnées viennent du content script ; on ne leur fait pas confiance aveuglément.
 */
function isValidPoint(x, y) {
  return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0;
}

/**
 * Attache le débogueur à l'onglet et programme son détachement automatique.
 * Ne fait rien si l'extension est déjà attachée à cet onglet.
 * Lève une erreur si Chrome refuse (par exemple : une autre extension est déjà attachée).
 * @param {number} tabId
 */
async function attachDebugger(tabId) {
  if (attachedTabs.has(tabId)) return;
  await chrome.debugger.attach({ tabId }, DEBUGGER_PROTOCOL_VERSION);
  attachedTabs.set(
    tabId,
    setTimeout(() => detachDebugger(tabId), ATTACH_TIMEOUT_MS)
  );
}

/**
 * Détache le débogueur de l'onglet, s'il est attaché, et annule le minuteur de sécurité.
 * Le bandeau « … a commencé à déboguer ce navigateur » disparaît alors.
 * @param {number} tabId
 */
async function detachDebugger(tabId) {
  const timer = attachedTabs.get(tabId);
  if (timer === undefined) return; // pas attaché : rien à faire
  clearTimeout(timer);
  attachedTabs.delete(tabId);
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    // Déjà détaché (onglet fermé, bouton « Annuler » du bandeau cliqué…) : rien à faire.
  }
}

/**
 * Envoie un clic gauche réel aux coordonnées données, puis détache le débogueur.
 *
 * Un clic se compose de deux événements : appui (mousePressed) puis relâchement
 * (mouseReleased) au même endroit. Les coordonnées sont en pixels CSS, relatives au coin
 * supérieur gauche de la zone d'affichage de la page (comme getBoundingClientRect).
 *
 * Le débogueur est détaché dans tous les cas (bloc finally), même si une commande échoue.
 * @param {number} tabId
 * @param {number} x
 * @param {number} y
 */
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

// --- Blocage et masquage (scripts enregistrés) -------------------------------

/** Pages concernées : les mêmes que les content scripts du manifest. */
const YOUTUBE_MATCHES = ["https://www.youtube.com/*"];

/** Identifiants des scripts que cette extension enregistre auprès de Chrome. */
const BLOCKER_SCRIPT_ID = "yt-ad-blocker";
const HIDER_SCRIPT_ID = "yt-ad-hider";
const PAGE_SCRIPT_IDS = [BLOCKER_SCRIPT_ID, HIDER_SCRIPT_ID];

/**
 * Scripts à enregistrer pour ces réglages (aucun si l'extension est désactivée).
 * @param {object} settings réglages (complétés par les valeurs par défaut si besoin)
 * @returns {chrome.scripting.RegisteredContentScript[]}
 */
function pageScriptsFor(settings) {
  const { enabled, blockAds, hideAds } = Settings.normalizeSettings(settings);
  const scripts = [];
  if (!enabled) return scripts;
  if (blockAds) {
    scripts.push({
      id: BLOCKER_SCRIPT_ID,
      js: ["content/ad-blocker.js"],
      matches: YOUTUBE_MATCHES,
      runAt: "document_start", // avant les scripts de YouTube
      world: "MAIN", // dans la page : doit remplacer fetch et ytInitialPlayerResponse
      allFrames: false,
      persistAcrossSessions: true,
    });
  }
  if (hideAds) {
    scripts.push({
      id: HIDER_SCRIPT_ID,
      css: ["content/ad-hider.css"],
      matches: YOUTUBE_MATCHES,
      runAt: "document_start", // la feuille est en place avant l'affichage de la page
      allFrames: false,
      persistAcrossSessions: true,
    });
  }
  return scripts;
}

// File d'attente des synchronisations, sur le modèle de statsQueue : deux synchronisations
// simultanées pourraient enregistrer deux fois le même identifiant (erreur de Chrome).
let scriptsQueue = Promise.resolve();

/**
 * Met les scripts enregistrés en accord avec les réglages enregistrés : retire ceux qui ne
 * sont plus voulus, ajoute ceux qui manquent, ne touche pas aux autres.
 * @returns {Promise<void>}
 */
function syncPageScripts() {
  const run = scriptsQueue.then(async () => {
    const wanted = pageScriptsFor(await Settings.loadSettings(chrome.storage.local));
    const wantedIds = new Set(wanted.map((script) => script.id));
    const registered = await chrome.scripting.getRegisteredContentScripts({ ids: PAGE_SCRIPT_IDS });
    const registeredIds = new Set(registered.map((script) => script.id));

    const toRemove = [...registeredIds].filter((id) => !wantedIds.has(id));
    if (toRemove.length) await chrome.scripting.unregisterContentScripts({ ids: toRemove });
    const toAdd = wanted.filter((script) => !registeredIds.has(script.id));
    if (toAdd.length) await chrome.scripting.registerContentScripts(toAdd);
  });
  scriptsQueue = run.catch((error) => console.warn("[YouTube Ad Skip] scripts de blocage :", error));
  return run;
}

// --- Traitement des messages -------------------------------------------------

/**
 * Exécute un message déjà autorisé et renvoie la réponse à transmettre à l'expéditeur.
 * Exportée pour les tests (qui l'appellent directement, sans passer par chrome.runtime).
 * @param {{type: string, x?: number, y?: number}} message
 * @param {chrome.runtime.MessageSender} sender
 * @returns {Promise<{ok: boolean, error?: string} | undefined>}
 */
async function handleMessage(message, sender) {
  // Les pages de l'extension (popup) n'ont pas d'onglet : tabId vaut alors undefined,
  // ce qui ne pose pas de problème car elles n'envoient pas de message « debugger-* ».
  const tabId = sender.tab && sender.tab.id;
  switch (message.type) {
    case "debugger-attach":
      await attachDebugger(tabId);
      return { ok: true };
    case "debugger-click":
      if (!isValidPoint(message.x, message.y)) {
        await detachDebugger(tabId); // ne pas laisser le débogueur attaché inutilement
        return { ok: false, error: "coordonnées invalides" };
      }
      await dispatchTrustedClick(tabId, message.x, message.y);
      return { ok: true };
    case "debugger-detach":
      // Le content script renonce au clic (publicité terminée, bouton recouvert…).
      await detachDebugger(tabId);
      return { ok: true };
    case "ad-skipped":
      // Le content script a constaté que la publicité a bien été quittée après le clic.
      await recordSkippedAd();
      return { ok: true };
    case "stats-reset":
      await resetStats();
      return { ok: true };
    default:
      return undefined;
  }
}

// Point d'entrée des messages envoyés par chrome.runtime.sendMessage (content script, popup).
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Messages qui ne nous concernent pas : on ne répond pas (return false).
  if (!message || typeof message.type !== "string") return false;
  if (!CONTENT_MESSAGES.has(message.type) && !EXTENSION_PAGE_MESSAGES.has(message.type)) return false;

  if (!isAuthorized(message, sender)) {
    sendResponse({ ok: false, error: "expéditeur non autorisé" });
    return false;
  }

  // Les erreurs (débogueur déjà utilisé, onglet fermé…) sont renvoyées à l'expéditeur
  // sous forme de réponse { ok: false, error } plutôt que de faire planter le worker.
  handleMessage(message, sender).then(sendResponse, (error) =>
    sendResponse({ ok: false, error: String((error && error.message) || error) })
  );
  // « true » indique à Chrome que sendResponse sera appelée plus tard (réponse asynchrone) ;
  // sans cela, le canal de réponse serait fermé dès la fin de cette fonction.
  return true;
});

// Chrome détache lui-même le débogueur quand l'onglet est fermé ou que l'utilisateur
// clique sur « Annuler » dans le bandeau : on oublie alors l'onglet et son minuteur.
chrome.debugger.onDetach.addListener((source) => {
  const timer = attachedTabs.get(source.tabId);
  if (timer !== undefined) {
    clearTimeout(timer);
    attachedTabs.delete(source.tabId);
  }
});

// Onglet fermé : détacher par précaution (sans effet si l'extension n'y était pas attachée).
chrome.tabs.onRemoved.addListener((tabId) => detachDebugger(tabId));

// Réglage de blocage ou de masquage modifié (popup, page d'options) : resynchroniser.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && ["enabled", "blockAds", "hideAds"].some((key) => key in changes)) syncPageScripts();
});

// Synchronisation à chaque démarrage du service worker : installation, mise à jour,
// rechargement de l'extension ou redémarrage de Chrome. Sans effet si tout est déjà en place.
syncPageScripts().catch(() => {}); // erreur déjà journalisée par la file d'attente

// Export pour les tests Node. Dans Chrome, « module » n'existe pas : ce bloc est ignoré.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    isTrustedSender,
    isExtensionPage,
    isAuthorized,
    isValidPoint,
    handleMessage,
    pageScriptsFor,
    syncPageScripts,
    PAGE_SCRIPT_IDS,
    attachedTabs,
    ATTACH_TIMEOUT_MS,
    SESSION_COUNT_KEY,
    TOTAL_COUNT_KEY,
  };
}
