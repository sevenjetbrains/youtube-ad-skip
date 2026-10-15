// =============================================================================
// common/settings.js — réglages de l'extension
// =============================================================================
//
// Ce fichier est partagé par trois contextes différents :
//   - les content scripts (chargé en premier par le manifest) ;
//   - la popup (popup/popup.html) ;
//   - la page d'options (options/options.html).
// Il définit les réglages disponibles, leurs valeurs par défaut et les fonctions pour les
// lire, ce qui évite de répéter ces informations dans chaque fichier.
//
// Stockage : chaque réglage est une clé de chrome.storage.local (« enabled »,
// « autoSkip », « experimental »). Cette zone est conservée entre les redémarrages de
// Chrome, ce qui répond à l'exigence de persistance des préférences.
//
// Ce fichier n'écrit jamais : l'écriture est faite par la popup et la page d'options
// (chrome.storage.local.set). Les autres contextes sont prévenus par chrome.storage.onChanged.
// =============================================================================

// Objet global YtAdSkipSettings, créé une seule fois (le fichier peut être chargé plusieurs
// fois dans les tests). « var » permet la redéclaration sans erreur.
var YtAdSkipSettings =
  globalThis.YtAdSkipSettings ||
  (globalThis.YtAdSkipSettings = (function () {
    "use strict";

    /**
     * Valeurs par défaut ; chaque clé est enregistrée telle quelle dans chrome.storage.local.
     * Object.freeze empêche toute modification accidentelle de ces valeurs.
     */
    const DEFAULT_SETTINGS = Object.freeze({
      enabled: true, // activation globale (interrupteur de la popup)
      autoSkip: true, // clic automatique sur « Ignorer »
      experimental: false, // accélération des publicités non ignorables
    });

    /** Liste des noms de réglages : ["enabled", "autoSkip", "experimental"]. */
    const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);

    /**
     * Complète et nettoie des réglages lus : toute valeur non booléenne (absente, corrompue,
     * d'un autre type) reprend sa valeur par défaut. Les clés inconnues sont ignorées.
     * @param {object | null | undefined} raw réglages bruts
     * @returns {{enabled: boolean, autoSkip: boolean, experimental: boolean}}
     */
    function normalizeSettings(raw) {
      const settings = {};
      for (const key of SETTING_KEYS) {
        settings[key] = raw && typeof raw[key] === "boolean" ? raw[key] : DEFAULT_SETTINGS[key];
      }
      return settings;
    }

    /**
     * Lit les réglages dans une zone chrome.storage (local).
     * Passer DEFAULT_SETTINGS à get() demande ces clés ET fournit leur valeur par défaut
     * quand elles n'ont jamais été enregistrées (premier lancement).
     * @param {chrome.storage.StorageArea} storageArea
     */
    async function loadSettings(storageArea) {
      return normalizeSettings(await storageArea.get(DEFAULT_SETTINGS));
    }

    /**
     * Applique un événement chrome.storage.onChanged à des réglages ; renvoie null s'il ne les
     * concerne pas (autre zone de stockage, ou seulement les compteurs).
     *
     * Format de « changes » fourni par Chrome : { clé: { oldValue, newValue } }.
     * Une clé supprimée n'a pas de newValue : normalizeSettings lui redonne sa valeur par défaut.
     * @param {object} current réglages actuels
     * @param {object} changes changements reçus
     * @param {string} area zone concernée ("local", "session", "sync"…)
     */
    function applySettingChanges(current, changes, area) {
      if (area !== "local" || !SETTING_KEYS.some((key) => key in changes)) return null;
      const next = { ...current };
      for (const key of SETTING_KEYS) if (key in changes) next[key] = changes[key].newValue;
      return normalizeSettings(next);
    }

    /**
     * Vrai si la surveillance du lecteur a une utilité avec ces réglages : extension activée
     * ET au moins une fonction (clic automatique ou expérimentale) choisie. Sinon, la
     * surveillance est complètement arrêtée pour ne consommer aucune ressource.
     */
    function isActive(settings) {
      return settings.enabled && (settings.autoSkip || settings.experimental);
    }

    return { DEFAULT_SETTINGS, SETTING_KEYS, normalizeSettings, loadSettings, applySettingChanges, isActive };
  })());

// Export pour les tests Node. Dans Chrome, « module » n'existe pas : ce bloc est ignoré.
if (typeof module !== "undefined" && module.exports) module.exports = YtAdSkipSettings;
