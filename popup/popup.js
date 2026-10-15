// =============================================================================
// popup/popup.js — fenêtre qui s'ouvre au clic sur l'icône de l'extension
// =============================================================================
//
// Contenu de la fenêtre (voir popup.html) :
//   - interrupteur général « Ignorer les publicités » (réglage « enabled ») ;
//   - indicateur de l'état de l'onglet actif (pastille de couleur + texte) ;
//   - compteurs « cette session » et « au total » ;
//   - liens « Réinitialiser les statistiques », « Paramètres », « Aide et informations ».
//
// Sources des informations affichées :
//   - réglages : chrome.storage.local, via common/settings.js (chargé avant ce fichier) ;
//   - compteurs : chrome.storage.session (session) et chrome.storage.local (total).
//     Ils sont écrits uniquement par background.js ; la popup les lit et suit leurs
//     changements en direct grâce à chrome.storage.onChanged ;
//   - état de l'onglet : demandé au content script de l'onglet actif (message
//     « get-status »). Cette méthode ne nécessite pas la permission « tabs » : si l'onglet
//     n'est pas une page YouTube, il n'y a pas de content script et la question reste
//     sans réponse, ce qui suffit à afficher « Inactif sur cet onglet ».
//
// La popup est une page à part : elle est recréée à chaque ouverture et détruite à la
// fermeture. Le minuteur de rafraîchissement disparaît donc avec elle.
// =============================================================================
"use strict";

// Clés des compteurs (identiques à celles de background.js).
const SESSION_COUNT_KEY = "sessionSkipped";
const TOTAL_COUNT_KEY = "totalSkipped";

/** Intervalle (ms) de mise à jour de l'indicateur d'état tant que la fenêtre est ouverte. */
const STATUS_REFRESH_MS = 1000;

/**
 * Texte et couleur de l'indicateur. Fonction pure (sans accès à Chrome ni au DOM), ce qui
 * permet de la tester directement.
 *
 * « tone » choisit la couleur de la pastille dans popup.css :
 *   "ok" (vert) = actif et rien à faire, "warn" (orange) = publicité en cours,
 *   "muted" (gris) = en pause ou inactif.
 *
 * @param {{enabled: boolean, autoSkip: boolean, experimental: boolean}} settings
 * @param {{enabled: boolean, state: string} | null} reply réponse du content script (null = aucune)
 * @returns {{tone: "ok" | "warn" | "muted", text: string}}
 */
function describeStatus(settings, reply) {
  // Les réglages passent d'abord : s'ils mettent l'extension en pause, l'onglet importe peu.
  if (!settings.enabled) return { tone: "muted", text: "En pause" };
  if (!settings.autoSkip && !settings.experimental) {
    return { tone: "muted", text: "En pause — clic automatique désactivé dans les paramètres" };
  }
  // Pas de réponse : page non YouTube, ou onglet ouvert avant l'installation ou le
  // rechargement de l'extension (son content script est absent ou arrêté).
  if (!reply) return { tone: "muted", text: "Inactif sur cet onglet — ouvrez ou rechargez une page YouTube" };
  // Le content script répond mais n'a pas encore lu les réglages (tout début du chargement).
  if (!reply.enabled) return { tone: "muted", text: "Démarrage…" };

  // Complément de texte quand le clic est désactivé mais l'accélération active.
  const accelerated = settings.experimental ? " — lecture accélérée" : "";
  // Valeurs de reply.state : voir getAdState() dans content/detector.js.
  switch (reply.state) {
    case "no-player":
      return { tone: "ok", text: "Actif — en attente d'une vidéo" };
    case "no-ad":
      return { tone: "ok", text: "Actif — aucune publicité en cours" };
    case "ad-waiting":
      return {
        tone: "warn",
        text: settings.experimental
          ? "Publicité en cours — lecture accélérée"
          : "Publicité en cours — bouton « Ignorer » pas encore disponible",
      };
    case "ad-skippable":
      return {
        tone: "warn",
        text: settings.autoSkip
          ? "Publicité en cours — clic sur « Ignorer »"
          : "Publicité en cours — clic automatique désactivé" + accelerated,
      };
    default:
      return { tone: "muted", text: "État du lecteur inconnu" };
  }
}

/**
 * Met un nombre en forme à la française (espace comme séparateur des milliers : « 1 234 »).
 * Une valeur absente ou invalide est affichée « 0 ».
 */
function formatCount(value) {
  return Number.isFinite(value) ? value.toLocaleString("fr-FR") : "0";
}

/**
 * Demande son état au content script de l'onglet actif.
 * @returns {Promise<{enabled: boolean, state: string} | null>} null si aucune réponse
 */
async function queryActiveTabStatus() {
  try {
    // Sans permission « tabs », Chrome fournit quand même l'identifiant de l'onglet
    // (mais pas son adresse) : c'est tout ce dont on a besoin.
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id === undefined) return null;
    return (await chrome.tabs.sendMessage(tab.id, { type: "get-status" })) || null;
  } catch {
    // sendMessage échoue (« Receiving end does not exist ») quand l'onglet n'a pas de
    // content script : page non YouTube, page interne de Chrome, onglet non rechargé.
    return null;
  }
}

/**
 * Relie les éléments de popup.html aux réglages, aux compteurs et à l'onglet actif.
 * @param {typeof YtAdSkipSettings} Settings module common/settings.js
 */
function initPopup(Settings) {
  const enabledInput = document.getElementById("enabled");
  const statusEl = document.getElementById("status");
  const statusText = document.getElementById("status-text");
  const sessionEl = document.getElementById("session-count");
  const totalEl = document.getElementById("total-count");
  const resetButton = document.getElementById("reset");
  // Réglages par défaut en attendant la lecture du stockage (quelques millisecondes).
  let settings = Settings.normalizeSettings({});

  /** Interroge l'onglet actif et met l'indicateur à jour. */
  async function refreshStatus() {
    const { tone, text } = describeStatus(settings, await queryActiveTabStatus());
    statusEl.dataset.tone = tone; // attribut data-tone, utilisé par popup.css pour la couleur
    statusText.textContent = text;
  }

  // --- Lecture initiale ---
  Settings.loadSettings(chrome.storage.local).then((loaded) => {
    settings = loaded;
    enabledInput.checked = settings.enabled;
    refreshStatus();
  });
  chrome.storage.local.get({ [TOTAL_COUNT_KEY]: 0 }).then((values) => {
    totalEl.textContent = formatCount(values[TOTAL_COUNT_KEY]);
  });
  chrome.storage.session.get({ [SESSION_COUNT_KEY]: 0 }).then((values) => {
    sessionEl.textContent = formatCount(values[SESSION_COUNT_KEY]);
  });

  // --- Suivi en direct ---
  // Une publicité ignorée dans un onglet, un réglage changé dans la page d'options…
  // la fenêtre se met à jour sans avoir à être rouverte.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "session" && changes[SESSION_COUNT_KEY]) {
      sessionEl.textContent = formatCount(changes[SESSION_COUNT_KEY].newValue);
    }
    if (area === "local" && changes[TOTAL_COUNT_KEY]) {
      totalEl.textContent = formatCount(changes[TOTAL_COUNT_KEY].newValue);
    }
    const next = Settings.applySettingChanges(settings, changes, area);
    if (next) {
      settings = next;
      enabledInput.checked = settings.enabled;
      refreshStatus();
    }
  });

  // --- Actions de l'utilisateur ---

  // Interrupteur : on enregistre simplement le réglage. Les onglets YouTube sont prévenus
  // par chrome.storage.onChanged et s'arrêtent ou redémarrent d'eux-mêmes ; la popup aussi
  // (écouteur ci-dessus), ce qui met l'indicateur à jour.
  enabledInput.addEventListener("change", async () => {
    await chrome.storage.local.set({ enabled: enabledInput.checked });
  });

  // Réinitialisation : demandée au service worker, seul à écrire les compteurs. Le bouton
  // est désactivé pendant l'opération pour éviter un double clic.
  resetButton.addEventListener("click", async () => {
    resetButton.disabled = true;
    try {
      await chrome.runtime.sendMessage({ type: "stats-reset" });
    } finally {
      resetButton.disabled = false;
    }
  });

  // Ouvre options/options.html (déclarée dans « options_ui » du manifest) dans un onglet.
  document.getElementById("open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());

  // L'état de l'onglet change sans événement de stockage (début d'une publicité…) :
  // on le redemande chaque seconde tant que la fenêtre est ouverte.
  setInterval(refreshStatus, STATUS_REFRESH_MS);
}

// Dans Node (tests), on exporte les fonctions pures ; dans Chrome, on initialise la fenêtre.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { describeStatus, formatCount };
} else {
  initPopup(YtAdSkipSettings);
}
