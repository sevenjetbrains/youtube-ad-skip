// Popup : interrupteur global, état de l'onglet actif et statistiques.
//
// Les compteurs sont écrits uniquement par background.js ; la popup les lit et suit leurs
// changements. L'état de l'onglet est demandé à son content script (« get-status ») :
// aucune permission « tabs » n'est nécessaire.
"use strict";

const SESSION_COUNT_KEY = "sessionSkipped";
const TOTAL_COUNT_KEY = "totalSkipped";
const STATUS_REFRESH_MS = 1000;

/**
 * Texte et couleur de l'indicateur.
 * @param {{enabled: boolean, autoSkip: boolean, experimental: boolean}} settings
 * @param {{enabled: boolean, state: string} | null} reply réponse du content script (null = aucune)
 */
function describeStatus(settings, reply) {
  if (!settings.enabled) return { tone: "muted", text: "En pause" };
  if (!settings.autoSkip && !settings.experimental) {
    return { tone: "muted", text: "En pause — clic automatique désactivé dans les paramètres" };
  }
  if (!reply) return { tone: "muted", text: "Inactif sur cet onglet — ouvrez ou rechargez une page YouTube" };
  if (!reply.enabled) return { tone: "muted", text: "Démarrage…" };
  const accelerated = settings.experimental ? " — lecture accélérée" : "";
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

function formatCount(value) {
  return Number.isFinite(value) ? value.toLocaleString("fr-FR") : "0";
}

async function queryActiveTabStatus() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id === undefined) return null;
    return (await chrome.tabs.sendMessage(tab.id, { type: "get-status" })) || null;
  } catch {
    return null; // pas de content script dans cet onglet
  }
}

function initPopup(Settings) {
  const enabledInput = document.getElementById("enabled");
  const statusEl = document.getElementById("status");
  const statusText = document.getElementById("status-text");
  const sessionEl = document.getElementById("session-count");
  const totalEl = document.getElementById("total-count");
  const resetButton = document.getElementById("reset");
  let settings = Settings.normalizeSettings({});

  async function refreshStatus() {
    const { tone, text } = describeStatus(settings, await queryActiveTabStatus());
    statusEl.dataset.tone = tone;
    statusText.textContent = text;
  }

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

  enabledInput.addEventListener("change", async () => {
    await chrome.storage.local.set({ enabled: enabledInput.checked });
  });

  resetButton.addEventListener("click", async () => {
    resetButton.disabled = true;
    try {
      await chrome.runtime.sendMessage({ type: "stats-reset" });
    } finally {
      resetButton.disabled = false;
    }
  });

  document.getElementById("open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());

  setInterval(refreshStatus, STATUS_REFRESH_MS);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { describeStatus, formatCount };
} else {
  initPopup(YtAdSkipSettings);
}
