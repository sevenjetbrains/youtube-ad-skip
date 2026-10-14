const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createYouTubeDom } = require("./helpers/youtube-dom");
require("../content/detector.js");
const ns = require("../content/ad-skipper.js");

/** DOM avec bouton « Ignorer » positionné et non recouvert (jsdom n'a pas de mise en page). */
function setup({ skipClass = "ytp-skip-ad-button", covered = false, bridgeReplies = {} } = {}) {
  const doc = createYouTubeDom({ ad: true, skipClass }).window.document;
  const button = doc.querySelector("button." + skipClass);
  button.getBoundingClientRect = () => ({ left: 900, top: 500, width: 120, height: 40 });
  doc.elementFromPoint = () => (covered ? doc.body : button.firstElementChild);

  const sent = [];
  const bridge = {
    async send(message) {
      sent.push(message);
      const reply = bridgeReplies[message.type];
      if (typeof reply === "function") return reply(message);
      return reply ?? { ok: true };
    },
  };
  let skipped = 0;
  let clock = 10_000;
  const skipper = new ns.AdSkipper({
    doc,
    bridge,
    onSkipped: () => skipped++,
    now: () => clock,
    delays: { settle: 0, verify: 0 },
  });
  return {
    doc,
    button,
    sent,
    skipper,
    get skipped() {
      return skipped;
    },
    advance(ms) {
      clock += ms;
    },
    check: () => skipper.handle(ns.getAdState(doc)),
  };
}

/** Simule l'effet d'un vrai clic réussi : YouTube masque le bouton puis quitte la publicité. */
function adEndsOnClick(ctx) {
  return () => {
    ctx.button.style.display = "none";
    ctx.doc.getElementById("movie_player").classList.remove("ad-showing");
    return { ok: true };
  };
}

test("clic réel demandé au centre du bouton, publicité comptée (scénario 2)", async () => {
  const replies = {};
  const ctx = setup({ bridgeReplies: replies });
  replies["debugger-click"] = adEndsOnClick(ctx);
  await ctx.check();
  assert.deepEqual(ctx.sent, [
    { type: "debugger-attach" },
    { type: "debugger-click", x: 960, y: 520 },
  ]);
  assert.equal(ctx.skipped, 1);
});

test("aucune action hors publicité ou sans bouton (scénarios 1 et 4)", async () => {
  for (const opts of [{ ad: false }, { ad: true }]) {
    const doc = createYouTubeDom(opts).window.document;
    const sent = [];
    const skipper = new ns.AdSkipper({ doc, bridge: { send: async (m) => sent.push(m) } });
    await skipper.handle(ns.getAdState(doc));
    assert.deepEqual(sent, []);
  }
});

test("bouton recouvert par un autre élément : pas de clic, débogueur détaché", async () => {
  const ctx = setup({ covered: true });
  await ctx.check();
  assert.deepEqual(ctx.sent.map((m) => m.type), ["debugger-attach", "debugger-detach"]);
  assert.equal(ctx.skipped, 0);
});

test("débogueur indisponible : pas de clic, pas de comptage (scénario 10)", async () => {
  const ctx = setup({ bridgeReplies: { "debugger-attach": { ok: false, error: "Another debugger is already attached" } } });
  await ctx.check();
  assert.deepEqual(ctx.sent.map((m) => m.type), ["debugger-attach"]);
  assert.equal(ctx.skipped, 0);
});

test("clic sans effet : non compté, nouvelles tentatives espacées et limitées", async () => {
  const ctx = setup(); // le bouton reste visible après chaque clic
  await ctx.check();
  assert.equal(ctx.skipped, 0);

  await ctx.check(); // trop tôt : ignoré
  assert.equal(ctx.sent.filter((m) => m.type === "debugger-click").length, 1);

  for (let i = 0; i < 5; i++) {
    ctx.advance(ns.RETRY_DELAY_MS);
    await ctx.check();
  }
  assert.equal(ctx.sent.filter((m) => m.type === "debugger-click").length, ns.MAX_ATTEMPTS_PER_AD);
  assert.equal(ctx.skipped, 0);
});

test("pas de double clic pendant une tentative en cours", async () => {
  const ctx = setup();
  const first = ctx.check();
  const second = ctx.check(); // arrive pendant la première
  await Promise.all([first, second]);
  assert.equal(ctx.sent.filter((m) => m.type === "debugger-attach").length, 1);
});

test("publicités successives : chacune est ignorée et comptée (scénario 5)", async () => {
  const replies = {};
  const ctx = setup({ bridgeReplies: replies });
  // Le clic passe à la publicité suivante : le bouton est masqué, ad-showing reste.
  replies["debugger-click"] = () => {
    ctx.button.style.display = "none";
    return { ok: true };
  };
  await ctx.check();
  assert.equal(ctx.skipped, 1);

  await ctx.check(); // seconde publicité, bouton pas encore disponible
  ctx.button.style.display = ""; // il apparaît
  ctx.advance(ns.RETRY_DELAY_MS);
  await ctx.check();
  assert.equal(ctx.skipped, 2);
});

test("la publicité se termine pendant l'attachement : pas de clic", async () => {
  const replies = {};
  const ctx = setup({ bridgeReplies: replies });
  replies["debugger-attach"] = () => {
    ctx.doc.getElementById("movie_player").classList.remove("ad-showing");
    return { ok: true };
  };
  await ctx.check();
  assert.deepEqual(ctx.sent.map((m) => m.type), ["debugger-attach", "debugger-detach"]);
  assert.equal(ctx.skipped, 0);
});

test("getClickPoint : bouton sans taille", () => {
  const doc = createYouTubeDom().window.document;
  const el = doc.createElement("button");
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 });
  assert.equal(ns.getClickPoint(el), null);
});
