// =============================================================================
// Tests de common/settings.js — réglages et valeurs par défaut
// =============================================================================
//
// Vérifie les valeurs par défaut (activé, clic automatique, expérimental désactivé), la
// correction des valeurs invalides, l'application des événements chrome.storage.onChanged
// et la règle qui décide si la surveillance du lecteur est utile.
//
// Lancement : npm test (tous les fichiers) ou node --test tests/settings.test.js (ce fichier seul).
// Outils : node:test (exécuteur de tests intégré à Node) et node:assert/strict
// (vérifications : equal compare avec ===, deepEqual compare le contenu des objets).
// =============================================================================

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createFakeStorage } = require("./helpers/fake-storage");
const Settings = require("../common/settings.js");

test("valeurs par défaut : activé, clic automatique, expérimental désactivé", async () => {
  assert.deepEqual(await Settings.loadSettings(createFakeStorage().local), {
    enabled: true,
    autoSkip: true,
    experimental: false,
  });
});

test("valeurs enregistrées relues, valeurs invalides remplacées par défaut", async () => {
  const storage = createFakeStorage({ local: { enabled: false, autoSkip: "oui", experimental: true } });
  assert.deepEqual(await Settings.loadSettings(storage.local), { enabled: false, autoSkip: true, experimental: true });
});

test("changements chrome.storage appliqués, autres zones et clés ignorées", () => {
  const current = Settings.normalizeSettings({});
  assert.deepEqual(Settings.applySettingChanges(current, { experimental: { newValue: true } }, "local"), {
    ...current,
    experimental: true,
  });
  assert.equal(Settings.applySettingChanges(current, { totalSkipped: { newValue: 3 } }, "local"), null);
  assert.equal(Settings.applySettingChanges(current, { enabled: { newValue: false } }, "session"), null);
  // Clé supprimée (newValue absent) : retour à la valeur par défaut.
  assert.equal(Settings.applySettingChanges({ ...current, enabled: false }, { enabled: {} }, "local").enabled, true);
});

test("surveillance utile seulement si activé et au moins une fonction choisie", () => {
  assert.equal(Settings.isActive({ enabled: true, autoSkip: true, experimental: false }), true);
  assert.equal(Settings.isActive({ enabled: true, autoSkip: false, experimental: true }), true);
  assert.equal(Settings.isActive({ enabled: true, autoSkip: false, experimental: false }), false);
  assert.equal(Settings.isActive({ enabled: false, autoSkip: true, experimental: true }), false);
});
