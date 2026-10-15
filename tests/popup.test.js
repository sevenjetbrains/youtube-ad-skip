const { test } = require("node:test");
const assert = require("node:assert/strict");
const { describeStatus, formatCount } = require("../popup/popup.js");

test("indicateur d'état selon le réglage et la réponse de l'onglet", () => {
  assert.equal(describeStatus(false, { enabled: true, state: "no-ad" }).text, "En pause");
  assert.match(describeStatus(true, null).text, /Inactif sur cet onglet/);
  assert.equal(describeStatus(true, { enabled: true, state: "no-ad" }).tone, "ok");
  assert.equal(describeStatus(true, { enabled: true, state: "no-player" }).tone, "ok");
  assert.equal(describeStatus(true, { enabled: true, state: "ad-waiting" }).tone, "warn");
  assert.equal(describeStatus(true, { enabled: true, state: "ad-skippable" }).tone, "warn");
  assert.match(describeStatus(true, { enabled: true, state: "bizarre" }).text, /inconnu/);
});

test("formatage des compteurs", () => {
  assert.equal(formatCount(0), "0");
  assert.equal(formatCount(undefined), "0");
  assert.equal(formatCount(1234).replace(/\s/g, " "), "1 234");
});
