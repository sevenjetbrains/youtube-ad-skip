// Page d'options : chaque interrupteur est relié à une clé de common/settings.js
// (attribut data-setting) et enregistré dans chrome.storage.local dès qu'il change.
"use strict";

const SAVED_MESSAGE_MS = 2000;

function initOptions(Settings) {
  const inputs = [...document.querySelectorAll("input[data-setting]")];
  const savedEl = document.getElementById("saved");
  let savedTimer = null;

  function render(settings) {
    for (const input of inputs) input.checked = settings[input.dataset.setting];
  }

  function showSaved(text, isError = false) {
    savedEl.textContent = text;
    savedEl.toggleAttribute("data-error", isError);
    clearTimeout(savedTimer);
    if (!isError) savedTimer = setTimeout(() => (savedEl.textContent = ""), SAVED_MESSAGE_MS);
  }

  let current = Settings.normalizeSettings({});
  Settings.loadSettings(chrome.storage.local).then((settings) => {
    current = settings;
    render(current);
  });

  // Changement fait ailleurs (popup, autre page d'options) : mettre l'affichage à jour.
  chrome.storage.onChanged.addListener((changes, area) => {
    const next = Settings.applySettingChanges(current, changes, area);
    if (next) {
      current = next;
      render(current);
    }
  });

  for (const input of inputs) {
    input.addEventListener("change", async () => {
      try {
        await chrome.storage.local.set({ [input.dataset.setting]: input.checked });
        showSaved("Enregistré.");
      } catch (error) {
        input.checked = !input.checked;
        showSaved("Enregistrement impossible : " + ((error && error.message) || error), true);
      }
    });
  }
}

initOptions(YtAdSkipSettings);
