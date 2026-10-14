const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createYouTubeDom } = require("./helpers/youtube-dom");
const detector = require("../content/detector.js");

const stateOf = (opts) => detector.getAdState(createYouTubeDom(opts).window.document).state;

test("pas de lecteur sur la page", () => {
  assert.equal(stateOf({ player: false }), "no-player");
});

test("vidéo ordinaire sans publicité (scénario 1)", () => {
  assert.equal(stateOf({ ad: false }), "no-ad");
});

test("publicité sans bouton « Ignorer » (scénario 4)", () => {
  assert.equal(stateOf({ ad: true }), "ad-waiting");
});

test("bouton présent mais encore masqué : attente (scénario 3)", () => {
  assert.equal(stateOf({ ad: true, skipClass: "ytp-skip-ad-button", skipVisible: false }), "ad-waiting");
});

test("bouton désactivé : attente", () => {
  assert.equal(stateOf({ ad: true, skipClass: "ytp-skip-ad-button", skipDisabled: true }), "ad-waiting");
});

for (const skipClass of detector.SKIP_BUTTON_CLASSES) {
  test(`bouton visible et activé (${skipClass}) : publicité ignorable (scénario 2)`, () => {
    const doc = createYouTubeDom({ ad: true, skipClass }).window.document;
    const { state, skipButton } = detector.getAdState(doc);
    assert.equal(state, "ad-skippable");
    assert.ok(skipButton.classList.contains(skipClass));
  });
}

test("le bouton devient disponible après coup (scénario 3)", () => {
  const doc = createYouTubeDom({ ad: true, skipClass: "ytp-skip-ad-button", skipVisible: false }).window.document;
  assert.equal(detector.getAdState(doc).state, "ad-waiting");
  doc.querySelector(".ytp-skip-ad-button").style.display = "";
  assert.equal(detector.getAdState(doc).state, "ad-skippable");
});

test("un ancêtre masqué rend le bouton invisible", () => {
  const doc = createYouTubeDom({ ad: true, skipClass: "ytp-skip-ad-button" }).window.document;
  doc.querySelector(".ytp-skip-ad").style.display = "none";
  assert.equal(detector.getAdState(doc).state, "ad-waiting");
});

test("hors publicité, un bouton « Ignorer » résiduel est ignoré", () => {
  // Le lecteur n'a pas la classe ad-showing : aucune action ne doit être proposée.
  assert.equal(stateOf({ ad: false, skipClass: "ytp-skip-ad-button" }), "no-ad");
});

test("ne retient jamais les boutons ordinaires du lecteur", () => {
  const doc = createYouTubeDom({ ad: true }).window.document;
  const player = detector.findPlayer(doc);
  for (const button of player.querySelectorAll("button")) {
    assert.equal(detector.isSkipButton(button, player), false, button.className);
  }
  assert.equal(detector.findUsableSkipButton(player), null);
});

test("un bouton « Ignorer » hors du lecteur n'est pas retenu", () => {
  const doc = createYouTubeDom({ ad: true }).window.document;
  const decoy = doc.createElement("button");
  decoy.className = "ytp-skip-ad-button";
  doc.body.appendChild(decoy);
  const player = detector.findPlayer(doc);
  assert.equal(detector.isSkipButton(decoy, player), false);
  assert.equal(detector.getAdState(doc).state, "ad-waiting");
});

test("un élément non-bouton portant la classe n'est pas retenu", () => {
  const doc = createYouTubeDom({ ad: true }).window.document;
  const div = doc.createElement("div");
  div.className = "ytp-skip-ad-button";
  doc.querySelector(".video-ads").appendChild(div);
  assert.equal(detector.getAdState(doc).state, "ad-waiting");
});

test("transitions pub → vidéo → pub (scénario 5)", () => {
  const doc = createYouTubeDom({ ad: true, skipClass: "ytp-skip-ad-button" }).window.document;
  const player = detector.findPlayer(doc);
  assert.equal(detector.getAdState(doc).state, "ad-skippable");
  player.classList.remove("ad-showing");
  assert.equal(detector.getAdState(doc).state, "no-ad");
  player.classList.add("ad-showing");
  assert.equal(detector.getAdState(doc).state, "ad-skippable");
});

test("le lecteur d'aperçu des miniatures n'est pas pris pour le lecteur principal", () => {
  const doc = createYouTubeDom({ ad: false }).window.document;
  const preview = doc.createElement("div");
  preview.className = "html5-video-player ad-showing";
  doc.body.prepend(preview);
  assert.equal(detector.findPlayer(doc).id, "movie_player");
  assert.equal(detector.getAdState(doc).state, "no-ad");
});

test("isElementVisible : élément détaché ou null", () => {
  const doc = createYouTubeDom().window.document;
  assert.equal(detector.isElementVisible(null), false);
  assert.equal(detector.isElementVisible(doc.createElement("button")), false);
});
