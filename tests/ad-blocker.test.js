// =============================================================================
// Tests de content/ad-blocker.js — blocage des publicités avant leur affichage
// =============================================================================
//
// Vérifie le nettoyage des données du lecteur (champs adPlacements, adSlots, playerAds),
// la reconnaissance des adresses concernées, puis les interceptions installées dans une
// fenêtre jsdom : variable ytInitialPlayerResponse, fetch, XMLHttpRequest et cadres vides.
// Les données utilisées reproduisent la structure relevée sur une page /watch réelle
// (voir docs/verification-selecteurs.md).
//
// Lancement : npm test (tous les fichiers) ou node --test tests/ad-blocker.test.js (ce fichier seul).
// Outils : node:test (exécuteur de tests intégré à Node) et node:assert/strict
// (vérifications : equal compare avec ===, deepEqual compare le contenu des objets).
// =============================================================================

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const { pruneAds, pruneAdsInText, isAdEndpoint, install } = require("../content/ad-blocker.js");

/** Réponse /player avec publicité, sur le modèle de ytInitialPlayerResponse. */
function playerResponse() {
  return {
    responseContext: {},
    playabilityStatus: { status: "OK" },
    videoDetails: { videoId: "dQw4w9WgXcQ" },
    adPlacements: [{ adPlacementRenderer: { config: { adPlacementConfig: { kind: "AD_PLACEMENT_KIND_START" } } } }],
    playerAds: [{ playerLegacyDesktopWatchAdsRenderer: {} }],
    adSlots: [{ adSlotRenderer: {} }],
    adBreakHeartbeatParams: "Q0FBJTNE",
  };
}

/** Fenêtre jsdom qui accepte l'exécution de scripts (pour « var ytInitialPlayerResponse = … »). */
function createWindow() {
  return new JSDOM("<!doctype html><html><body></body></html>", { runScripts: "outside-only" }).window;
}

test("retire les champs publicitaires et conserve le reste", () => {
  const data = playerResponse();
  assert.equal(pruneAds(data), true);
  assert.deepEqual(Object.keys(data), ["responseContext", "playabilityStatus", "videoDetails", "adBreakHeartbeatParams"]);
  assert.equal(pruneAds(data), false, "deuxième passage : plus rien à retirer");
});

test("réponses imbriquées : playerResponse et tableau /get_watch", () => {
  const nested = { playerResponse: playerResponse(), response: { contents: {} } };
  assert.equal(pruneAds(nested), true);
  assert.equal("adPlacements" in nested.playerResponse, false);

  const watch = [{ playerResponse: playerResponse() }, { response: {} }];
  assert.equal(pruneAds(watch), true);
  assert.equal("adSlots" in watch[0].playerResponse, false);
});

test("valeurs sans rapport ignorées sans erreur", () => {
  for (const value of [null, undefined, 0, "texte", [], {}, { videoDetails: {} }]) assert.equal(pruneAds(value), false);
});

test("nettoyage d'un texte JSON, et repli par renommage si le texte n'est pas du JSON", () => {
  const cleaned = JSON.parse(pruneAdsInText(JSON.stringify(playerResponse())));
  assert.equal("adPlacements" in cleaned, false);
  assert.equal(cleaned.videoDetails.videoId, "dQw4w9WgXcQ");

  // Préfixe anti-XSSI : JSON.parse échoue, les clés sont renommées.
  const prefixed = ")]}'\n" + JSON.stringify(playerResponse());
  const renamed = pruneAdsInText(prefixed);
  assert.doesNotMatch(renamed, /"(adPlacements|adSlots|playerAds)"/);
  assert.match(renamed, /"no_ads":/);
  assert.match(renamed, /"videoId":"dQw4w9WgXcQ"/);

  assert.equal(pruneAdsInText('{"videoDetails":{}}'), null, "rien à retirer");
  assert.equal(pruneAdsInText(undefined), null);
});

test("adresses concernées : /player et /get_watch seulement", () => {
  assert.equal(isAdEndpoint("https://www.youtube.com/youtubei/v1/player?prettyPrint=false"), true);
  assert.equal(isAdEndpoint("/youtubei/v1/player"), true);
  assert.equal(isAdEndpoint("/youtubei/v1/get_watch?prettyPrint=false"), true);
  assert.equal(isAdEndpoint({ url: "https://www.youtube.com/youtubei/v1/player" }), true, "objet Request");
  assert.equal(isAdEndpoint(new URL("https://www.youtube.com/youtubei/v1/get_watch")), true, "objet URL");

  assert.equal(isAdEndpoint("/youtubei/v1/player/ad_break"), false);
  assert.equal(isAdEndpoint("/youtubei/v1/next"), false);
  assert.equal(isAdEndpoint("/youtubei/v1/browse"), false);
  assert.equal(isAdEndpoint("/watch?v=dQw4w9WgXcQ"), false);
  assert.equal(isAdEndpoint(undefined), false);
});

test("ytInitialPlayerResponse : publicités retirées dès l'affectation par la page", () => {
  const win = createWindow();
  install(win);
  // Même forme que le script de la page /watch.
  win.eval(`var ytInitialPlayerResponse = ${JSON.stringify(playerResponse())};`);
  assert.equal("adPlacements" in win.ytInitialPlayerResponse, false);
  assert.equal(win.ytInitialPlayerResponse.videoDetails.videoId, "dQw4w9WgXcQ");
  // Navigation suivante : YouTube remet la variable à null puis à une autre valeur.
  win.ytInitialPlayerResponse = null;
  assert.equal(win.ytInitialPlayerResponse, null);
});

test("ytInitialPlayerResponse déjà présente avant l'installation : nettoyée aussi", () => {
  const win = createWindow();
  win.ytInitialPlayerResponse = playerResponse();
  install(win);
  assert.equal("adSlots" in win.ytInitialPlayerResponse, false);
});

/** Installe un faux fetch qui renvoie toujours la réponse donnée, puis le blocage. */
function windowWithFetch(body) {
  const win = createWindow();
  const requests = [];
  const original = async (input) => {
    requests.push(String(input));
    return new Response(body, { status: 200, headers: { "content-type": "application/json", "content-length": String(body.length) } });
  };
  win.fetch = original;
  win.Response = Response;
  win.Headers = Headers;
  install(win);
  return { win, requests, original };
}

test("fetch : réponse /player nettoyée, statut et en-têtes conservés", async () => {
  const { win, requests } = windowWithFetch(JSON.stringify(playerResponse()));
  const response = await win.fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", { method: "POST" });
  assert.deepEqual(requests, ["https://www.youtube.com/youtubei/v1/player?prettyPrint=false"]);
  assert.equal(response.status, 200);
  assert.equal(response.ok, true);
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.equal(response.headers.get("content-length"), null, "taille d'origine retirée");
  const data = await response.json();
  assert.equal("adPlacements" in data, false);
  assert.equal(data.videoDetails.videoId, "dQw4w9WgXcQ");
});

test("fetch : autres adresses et réponses sans publicité rendues telles quelles", async () => {
  const { win } = windowWithFetch(JSON.stringify(playerResponse()));
  const other = await win.fetch("/youtubei/v1/next");
  assert.equal("adPlacements" in (await other.json()), true, "adresse sans rapport : aucune modification");

  const clean = windowWithFetch('{"videoDetails":{}}');
  const response = await clean.win.fetch("/youtubei/v1/player");
  assert.deepEqual(await response.json(), { videoDetails: {} });
});

test("fetch remplacé reste discret : toString natif", () => {
  const { win } = windowWithFetch("{}");
  assert.match(Function.prototype.toString.call(win.fetch), /\[native code\]/);
});

/** Fausse XMLHttpRequest : prototype avec open() et accesseurs, comme celle du navigateur. */
function createFakeXhrClass(body, responseType = "") {
  class FakeXhr {
    open(method, url) {
      this.url = url;
    }
    get readyState() {
      return 4;
    }
    get responseType() {
      return responseType;
    }
    get responseText() {
      return body;
    }
    get response() {
      return responseType === "json" ? JSON.parse(body) : body;
    }
  }
  return FakeXhr;
}

test("XMLHttpRequest : responseText et response nettoyés pour /player", () => {
  const win = createWindow();
  win.XMLHttpRequest = createFakeXhrClass(JSON.stringify(playerResponse()));
  install(win);
  const xhr = new win.XMLHttpRequest();
  xhr.open("POST", "/youtubei/v1/player?prettyPrint=false");
  assert.equal("adSlots" in JSON.parse(xhr.responseText), false);
  assert.equal(xhr.responseText, xhr.response, "même texte nettoyé, calculé une fois");

  const other = new win.XMLHttpRequest();
  other.open("GET", "/youtubei/v1/browse");
  assert.equal("adSlots" in JSON.parse(other.responseText), true);
});

test("XMLHttpRequest en mode json : objet nettoyé en place", () => {
  const win = createWindow();
  win.XMLHttpRequest = createFakeXhrClass(JSON.stringify(playerResponse()), "json");
  install(win);
  const xhr = new win.XMLHttpRequest();
  xhr.open("POST", "/youtubei/v1/get_watch");
  assert.equal("playerAds" in xhr.response, false);
});

test("cadre vide inséré : son fetch est intercepté aussi (contournement empêché)", async () => {
  const win = createWindow();
  install(win);
  // Fenêtre du cadre simulée : jsdom ne fournit pas fetch dans ses cadres.
  const frameFetch = async () => new Response(JSON.stringify(playerResponse()));
  const frameWin = { location: { href: "about:blank" }, fetch: frameFetch, Response, Headers };
  const iframe = win.document.createElement("iframe");
  Object.defineProperty(iframe, "contentWindow", { get: () => frameWin });
  win.document.body.appendChild(iframe);

  assert.notEqual(frameWin.fetch, frameFetch, "fetch du cadre remplacé");
  const data = await (await frameWin.fetch("/youtubei/v1/player")).json();
  assert.equal("adPlacements" in data, false);
});
