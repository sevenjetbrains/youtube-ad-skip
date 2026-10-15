// =============================================================================
// tests/helpers/fake-storage.js — faux chrome.storage pour les tests
// =============================================================================
//
// Reproduit le comportement utile de chrome.storage :
//   - get(valeursParDéfaut) : renvoie les valeurs enregistrées, ou les valeurs par défaut
//     pour les clés absentes (comme Chrome) ;
//   - set(valeurs) : enregistre puis prévient les écouteurs onChanged avec le même format
//     que Chrome : { clé: { oldValue, newValue } } et le nom de la zone ("local", "session").
// La propriété « data » donne accès direct au contenu, pour préparer ou vérifier un test.
// =============================================================================

/**
 * Crée une zone de stockage.
 * @param {string} name nom de la zone transmis aux écouteurs ("local" ou "session")
 * @param {Function[]} listeners écouteurs onChanged, partagés entre les zones
 * @param {object} [initial] contenu de départ
 */
function createStorageArea(name, listeners, initial = {}) {
  const data = { ...initial };
  return {
    data,
    async get(defaults = {}) {
      const result = { ...defaults };
      for (const key of Object.keys(defaults)) if (key in data) result[key] = data[key];
      return result;
    },
    async set(values) {
      const changes = {};
      for (const [key, value] of Object.entries(values)) {
        changes[key] = { oldValue: data[key], newValue: value };
        data[key] = value;
      }
      for (const listener of listeners) listener(changes, name);
    },
  };
}

/** Renvoie { local, session, onChanged } compatible avec chrome.storage. */
function createFakeStorage({ local = {}, session = {} } = {}) {
  const listeners = [];
  return {
    local: createStorageArea("local", listeners, local),
    session: createStorageArea("session", listeners, session),
    onChanged: { addListener: (fn) => listeners.push(fn) },
  };
}

module.exports = { createFakeStorage };
