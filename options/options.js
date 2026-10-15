// =============================================================================
// options/options.js — page de paramètres de l'extension
// =============================================================================
//
// La page (options.html) contient un interrupteur par réglage. Chaque interrupteur porte
// un attribut data-setting dont la valeur est le nom du réglage dans common/settings.js :
//   <input type="checkbox" data-setting="autoSkip">
// Ce fichier n'a donc pas besoin de connaître la liste des réglages : il relie
// automatiquement chaque case à la clé correspondante de chrome.storage.local.
//
// Enregistrement : immédiat, dès qu'un interrupteur change (pas de bouton « Enregistrer »).
// Les onglets YouTube ouverts et la popup sont prévenus par chrome.storage.onChanged et
// appliquent le changement aussitôt.
// =============================================================================
"use strict";

/** Durée (ms) d'affichage du message « Enregistré. ». */
const SAVED_MESSAGE_MS = 2000;

/**
 * Relie les interrupteurs de la page aux réglages enregistrés.
 * @param {typeof YtAdSkipSettings} Settings module common/settings.js
 */
function initOptions(Settings) {
  const inputs = [...document.querySelectorAll("input[data-setting]")];
  const savedEl = document.getElementById("saved"); // zone du message de confirmation
  let savedTimer = null;

  /** Coche ou décoche chaque interrupteur selon les réglages donnés. */
  function render(settings) {
    for (const input of inputs) input.checked = settings[input.dataset.setting];
  }

  /**
   * Affiche un message de confirmation (effacé après SAVED_MESSAGE_MS) ou d'erreur (conservé).
   * L'attribut data-error fait passer le texte en rouge (voir options.css).
   */
  function showSaved(text, isError = false) {
    savedEl.textContent = text;
    savedEl.toggleAttribute("data-error", isError);
    clearTimeout(savedTimer);
    if (!isError) savedTimer = setTimeout(() => (savedEl.textContent = ""), SAVED_MESSAGE_MS);
  }

  // Réglages par défaut en attendant la lecture du stockage, puis valeurs enregistrées.
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

  // Enregistrement à chaque changement d'interrupteur.
  for (const input of inputs) {
    input.addEventListener("change", async () => {
      try {
        await chrome.storage.local.set({ [input.dataset.setting]: input.checked });
        showSaved("Enregistré.");
      } catch (error) {
        // Échec (rare : stockage indisponible) : on remet l'interrupteur dans son état
        // précédent pour que l'affichage reflète la valeur réellement enregistrée.
        input.checked = !input.checked;
        showSaved("Enregistrement impossible : " + ((error && error.message) || error), true);
      }
    });
  }
}

// YtAdSkipSettings est défini par ../common/settings.js, chargé juste avant dans options.html.
initOptions(YtAdSkipSettings);
