// Fausse zone chrome.storage (local ou session) : get avec valeurs par défaut, set, onChanged.

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
