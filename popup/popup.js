// Popup : interrupteur global, état de l'onglet actif et statistiques.
//
// Les compteurs sont écrits uniquement par background.js ; la popup les lit et suit leurs
// changements. L'état de l'onglet est demandé à son content script (« get-status ») :
// aucune permission « tabs » n'est nécessaire.
"use strict";

const ENABLED_KEY = "enabled";
const SESSION_COUNT_KEY = "sessionSkipped";
const TOTAL_COUNT_KEY = "totalSkipped";
const STATUS_REFRESH_MS = 1000;

/** Texte et couleur de l'indicateur selon la réponse du content script (null = pas de réponse). */
function describeStatus(enabledSetting, reply) {
  if (!enabledSetting) return { tone: "muted", text: "En pause" };
  if (!reply) return { tone: "muted", text: "Inactif sur cet onglet — ouvrez ou rechargez une page YouTube" };
  if (!reply.enabled) return { tone: "muted", text: "Démarrage…" };
  switch (reply.state) {
    case "no-player":
      return { tone: "ok", text: "Actif — en attente d'une vidéo" };
    case "no-ad":
      return { tone: "ok", text: "Actif — aucune publicité en cours" };
    case "ad-waiting":
      return { tone: "warn", text: "Publicité en cours — bouton « Ignorer » pas encore disponible" };
    case "ad-skippable":
      return { tone: "warn", text: "Publicité en cours — clic sur « Ignorer »" };
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

function initPopup() {
  const enabledInput = document.getElementById("enabled");
  const statusEl = document.getElementById("status");
  const statusText = document.getElementById("status-text");
  const sessionEl = document.getElementById("session-count");
  const totalEl = document.getElementById("total-count");
  const resetButton = document.getElementById("reset");

  async function refreshStatus() {
    const { tone, text } = describeStatus(enabledInput.checked, await queryActiveTabStatus());
    statusEl.dataset.tone = tone;
    statusText.textContent = text;
  }

  chrome.storage.local.get({ [ENABLED_KEY]: true, [TOTAL_COUNT_KEY]: 0 }).then((values) => {
    enabledInput.checked = values[ENABLED_KEY] !== false;
    totalEl.textContent = formatCount(values[TOTAL_COUNT_KEY]);
    refreshStatus();
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
    if (area === "local" && changes[ENABLED_KEY]) {
      enabledInput.checked = changes[ENABLED_KEY].newValue !== false;
      refreshStatus();
    }
  });

  enabledInput.addEventListener("change", async () => {
    await chrome.storage.local.set({ [ENABLED_KEY]: enabledInput.checked });
    refreshStatus();
  });

  resetButton.addEventListener("click", async () => {
    resetButton.disabled = true;
    try {
      await chrome.runtime.sendMessage({ type: "stats-reset" });
    } finally {
      resetButton.disabled = false;
    }
  });

  setInterval(refreshStatus, STATUS_REFRESH_MS);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { describeStatus, formatCount };
} else {
  initPopup();
}
