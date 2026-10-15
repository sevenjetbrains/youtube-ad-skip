// =============================================================================
// Tests de popup/popup.js — fonctions pures de la fenêtre
// =============================================================================
//
// describeStatus() et formatCount() ne dépendent ni de Chrome ni du DOM : on les teste
// directement. Le reste de la popup (lecture du stockage, interrupteur, boutons) est
// vérifié manuellement dans Chrome (docs/procedure-test-manuel.md).
//
// Lancement : npm test (tous les fichiers) ou node --test tests/popup.test.js (ce fichier seul).
// Outils : node:test (exécuteur de tests intégré à Node) et node:assert/strict
// (vérifications : equal compare avec ===, deepEqual compare le contenu des objets).
// =============================================================================

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { describeStatus, formatCount } = require("../popup/popup.js");

const DEFAULTS = { enabled: true, autoSkip: true, experimental: false };
const active = (state) => ({ enabled: true, state });

test("indicateur d'état selon les réglages et la réponse de l'onglet", () => {
  assert.equal(describeStatus({ ...DEFAULTS, enabled: false }, active("no-ad")).text, "En pause");
  assert.match(describeStatus({ ...DEFAULTS, autoSkip: false }, active("no-ad")).text, /désactivé dans les paramètres/);
  assert.match(describeStatus(DEFAULTS, null).text, /Inactif sur cet onglet/);
  assert.equal(describeStatus(DEFAULTS, active("no-ad")).tone, "ok");
  assert.equal(describeStatus(DEFAULTS, active("no-player")).tone, "ok");
  assert.equal(describeStatus(DEFAULTS, active("ad-waiting")).tone, "warn");
  assert.match(describeStatus(DEFAULTS, active("ad-skippable")).text, /clic sur « Ignorer »/);
  assert.match(describeStatus(DEFAULTS, active("bizarre")).text, /inconnu/);
});

test("indicateur avec la fonction expérimentale", () => {
  const exp = { ...DEFAULTS, experimental: true };
  assert.match(describeStatus(exp, active("ad-waiting")).text, /accélérée/);
  const expOnly = { ...exp, autoSkip: false };
  assert.equal(describeStatus(expOnly, active("no-ad")).tone, "ok", "expérimental seul : actif");
  assert.match(describeStatus(expOnly, active("ad-skippable")).text, /clic automatique désactivé — lecture accélérée/);
});

test("formatage des compteurs", () => {
  assert.equal(formatCount(0), "0");
  assert.equal(formatCount(undefined), "0");
  assert.equal(formatCount(1234).replace(/\s/g, " "), "1 234");
});
