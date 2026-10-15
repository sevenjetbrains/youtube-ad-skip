const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createYouTubeDom } = require("./helpers/youtube-dom");
require("../content/detector.js");
const ns = require("../content/ad-accelerator.js");

function setup(opts) {
  const doc = createYouTubeDom(opts).window.document;
  const accelerator = new ns.AdAccelerator();
  return {
    doc,
    video: doc.querySelector("video.html5-main-video"),
    player: doc.getElementById("movie_player"),
    accelerator,
    check: () => accelerator.handle(ns.getAdState(doc)),
  };
}

test("vidéo ordinaire : rien n'est modifié (scénario 1)", () => {
  const ctx = setup({ ad: false });
  ctx.video.playbackRate = 1.5; // vitesse choisie par l'utilisateur
  ctx.check();
  assert.equal(ctx.video.playbackRate, 1.5);
  assert.equal(ctx.video.muted, false);
});

test("publicité non ignorable : accélérée et muette, puis rétablie à la fin (scénario 4)", () => {
  const ctx = setup({ ad: true });
  ctx.check();
  assert.equal(ctx.video.playbackRate, ns.AD_PLAYBACK_RATE);
  assert.equal(ctx.video.muted, true);

  ctx.player.classList.remove("ad-showing");
  ctx.check();
  assert.equal(ctx.video.playbackRate, 1);
  assert.equal(ctx.video.muted, false);
});

test("vitesse remise à 1 par YouTube pendant la publicité : réappliquée", () => {
  const ctx = setup({ ad: true });
  ctx.check();
  ctx.video.playbackRate = 1;
  ctx.check();
  assert.equal(ctx.video.playbackRate, ns.AD_PLAYBACK_RATE);
});

test("son déjà coupé par l'utilisateur : reste coupé après la publicité", () => {
  const ctx = setup({ ad: true });
  ctx.video.muted = true;
  ctx.check();
  ctx.player.classList.remove("ad-showing");
  ctx.check();
  assert.equal(ctx.video.muted, true);
});

test("vitesse déjà rétablie par YouTube : non écrasée", () => {
  const ctx = setup({ ad: true });
  ctx.check();
  ctx.video.playbackRate = 1.25; // YouTube applique la vitesse de la vidéo suivante
  ctx.player.classList.remove("ad-showing");
  ctx.check();
  assert.equal(ctx.video.playbackRate, 1.25);
});

test("lecteur sans élément vidéo : aucune erreur", () => {
  const ctx = setup({ ad: true });
  ctx.video.remove();
  assert.doesNotThrow(() => ctx.check());
  assert.equal(ctx.accelerator.saved, null);
});
