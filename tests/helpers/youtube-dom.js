// =============================================================================
// tests/helpers/youtube-dom.js — faux lecteur YouTube pour les tests
// =============================================================================
//
// Construit, avec jsdom, une page minimale reproduisant la structure du lecteur YouTube
// telle qu'elle apparaît dans base.js (version 22cb88bc) :
//
//   <div id="movie_player" class="html5-video-player [ad-showing ad-interrupting]">
//     <div class="html5-video-container"><video class="video-stream html5-main-video"></video></div>
//     <div class="video-ads ytp-ad-module">
//       <div class="ytp-skip-ad"><button class="ytp-skip-ad-button ytp-button">…</button></div>
//     </div>
//     <div class="ytp-chrome-bottom"> boutons ordinaires (lecture, suivant) </div>
//   </div>
//
// Les boutons ordinaires servent à vérifier que l'extension ne clique jamais dessus.
// L'adresse de la page est https://www.youtube.com/watch?v=test.
// =============================================================================
const { JSDOM } = require("jsdom");

/**
 * @param {object} opts
 * @param {boolean} [opts.player=true]       présence de #movie_player
 * @param {boolean} [opts.ad=false]          classe ad-showing sur le lecteur
 * @param {string|null} [opts.skipClass]     classe du bouton « Ignorer » (null = aucun bouton)
 * @param {boolean} [opts.skipVisible=true]  bouton affiché (sinon display:none, comme YouTube)
 * @param {boolean} [opts.skipDisabled=false]
 */
function createYouTubeDom({
  player = true,
  ad = false,
  skipClass = null,
  skipVisible = true,
  skipDisabled = false,
} = {}) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://www.youtube.com/watch?v=test" });
  const doc = dom.window.document;
  if (!player) return dom;

  const playerEl = doc.createElement("div");
  playerEl.id = "movie_player";
  playerEl.className = "html5-video-player ytp-hide-controls" + (ad ? " ad-showing ad-interrupting" : "");
  playerEl.innerHTML = `
    <div class="html5-video-container"><video class="video-stream html5-main-video"></video></div>
    <div class="video-ads ytp-ad-module"></div>
    <div class="ytp-chrome-bottom">
      <button class="ytp-play-button ytp-button" aria-label="Lire"></button>
      <button class="ytp-next-button ytp-button" aria-label="Suivant"></button>
    </div>`;
  doc.body.appendChild(playerEl);

  if (skipClass) {
    const slot = doc.createElement("div");
    slot.className = "ytp-skip-ad";
    const button = doc.createElement("button");
    button.className = skipClass + " ytp-button";
    button.innerHTML = '<div class="ytp-skip-ad-button__text">Ignorer</div>';
    if (!skipVisible) button.style.display = "none";
    if (skipDisabled) button.disabled = true;
    slot.appendChild(button);
    playerEl.querySelector(".video-ads").appendChild(slot);
  }
  return dom;
}

module.exports = { createYouTubeDom };
