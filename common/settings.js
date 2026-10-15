// Réglages de l'extension, partagés par les content scripts, la popup et la page d'options.
// Ils sont enregistrés dans chrome.storage.local, conservé entre les redémarrages de Chrome.
var YtAdSkipSettings =
  globalThis.YtAdSkipSettings ||
  (globalThis.YtAdSkipSettings = (function () {
    "use strict";

    /** Valeurs par défaut ; chaque clé est enregistrée telle quelle dans chrome.storage.local. */
    const DEFAULT_SETTINGS = Object.freeze({
      enabled: true, // activation globale (interrupteur de la popup)
      autoSkip: true, // clic automatique sur « Ignorer »
      experimental: false, // accélération des publicités non ignorables
    });
    const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);

    /** Complète et nettoie des réglages lus : toute valeur non booléenne reprend sa valeur par défaut. */
    function normalizeSettings(raw) {
      const settings = {};
      for (const key of SETTING_KEYS) {
        settings[key] = raw && typeof raw[key] === "boolean" ? raw[key] : DEFAULT_SETTINGS[key];
      }
      return settings;
    }

    /** Lit les réglages dans une zone chrome.storage (local). */
    async function loadSettings(storageArea) {
      return normalizeSettings(await storageArea.get(DEFAULT_SETTINGS));
    }

    /** Applique un événement chrome.storage.onChanged à des réglages ; renvoie null s'il ne les concerne pas. */
    function applySettingChanges(current, changes, area) {
      if (area !== "local" || !SETTING_KEYS.some((key) => key in changes)) return null;
      const next = { ...current };
      for (const key of SETTING_KEYS) if (key in changes) next[key] = changes[key].newValue;
      return normalizeSettings(next);
    }

    /** Vrai si la surveillance du lecteur a une utilité avec ces réglages. */
    function isActive(settings) {
      return settings.enabled && (settings.autoSkip || settings.experimental);
    }

    return { DEFAULT_SETTINGS, SETTING_KEYS, normalizeSettings, loadSettings, applySettingChanges, isActive };
  })());

if (typeof module !== "undefined" && module.exports) module.exports = YtAdSkipSettings;
