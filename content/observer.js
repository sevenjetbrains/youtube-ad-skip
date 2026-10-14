// Point d'entrée du content script : surveillance du lecteur (MutationObserver)
// et de la navigation interne de YouTube.
//
// Stratégie économe :
//   - hors publicité, un seul observateur, limité à l'attribut « class » de #movie_player ;
//   - pendant une publicité seulement, observation du conteneur .video-ads (apparition du
//     bouton « Ignorer ») et vérification de secours toutes les 500 ms ;
//   - tant que le lecteur n'existe pas (accueil, recherche…), un observateur attend son
//     apparition puis se déconnecte.
var YtAdSkip = globalThis.YtAdSkip || (globalThis.YtAdSkip = {});

(function (ns) {
  "use strict";

  const AD_POLL_INTERVAL_MS = 500;
  const AD_CONTAINER_SELECTOR = ".video-ads";
  const NAVIGATION_EVENT = "yt-navigate-finish"; // vérifié dans le code de l'application YouTube

  /**
   * Surveille le lecteur et appelle onCheck(getAdState(doc)) à chaque changement pertinent.
   * Les appels sont regroupés : plusieurs mutations rapprochées donnent une seule vérification.
   */
  function createAdWatcher({ doc, onCheck }) {
    const view = doc.defaultView;
    let player = null;
    let playerObserver = null;
    let adObserver = null;
    let waitObserver = null;
    let pollTimer = null;
    let scheduled = false;
    let running = false;

    function scheduleCheck() {
      if (!running || scheduled) return;
      scheduled = true;
      view.setTimeout(runCheck, 0);
    }

    function runCheck() {
      scheduled = false;
      if (!running) return;
      try {
        const info = ns.getAdState(doc);
        watchPlayer(info.player);
        watchAd(info.state === "ad-waiting" || info.state === "ad-skippable");
        onCheck(info);
      } catch (error) {
        // Une erreur de détection ne doit jamais casser la page : on journalise et on continue.
        console.warn("[YouTube Ad Skip] erreur de détection :", error);
      }
    }

    function watchPlayer(next) {
      if (next === player) {
        if (!player) waitForPlayer(); // démarrage sur une page sans lecteur
        return;
      }
      stopWatchingAd();
      if (playerObserver) playerObserver.disconnect();
      playerObserver = null;
      player = next;
      if (player) {
        stopWaitingForPlayer();
        playerObserver = new view.MutationObserver(scheduleCheck);
        playerObserver.observe(player, { attributes: true, attributeFilter: ["class"] });
      } else {
        waitForPlayer();
      }
    }

    function waitForPlayer() {
      if (waitObserver) return;
      waitObserver = new view.MutationObserver(() => {
        if (ns.findPlayer(doc)) scheduleCheck();
      });
      waitObserver.observe(doc.documentElement, { childList: true, subtree: true });
    }

    function stopWaitingForPlayer() {
      if (waitObserver) waitObserver.disconnect();
      waitObserver = null;
    }

    function watchAd(active) {
      if (!active) return stopWatchingAd();
      if (adObserver) return;
      const container = player.querySelector(AD_CONTAINER_SELECTOR) || player;
      adObserver = new view.MutationObserver(scheduleCheck);
      adObserver.observe(container, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style", "class", "hidden", "disabled", "aria-disabled"],
      });
      // Secours : une transition CSS (opacité) ne produit pas toujours de mutation.
      pollTimer = view.setInterval(scheduleCheck, AD_POLL_INTERVAL_MS);
    }

    function stopWatchingAd() {
      if (adObserver) adObserver.disconnect();
      adObserver = null;
      if (pollTimer !== null) view.clearInterval(pollTimer);
      pollTimer = null;
    }

    function onNavigate() {
      scheduleCheck();
    }

    return {
      start() {
        if (running) return;
        running = true;
        doc.addEventListener(NAVIGATION_EVENT, onNavigate);
        scheduleCheck();
      },
      /** Arrête toute surveillance et libère observateurs, minuteurs et écouteurs. */
      stop() {
        running = false;
        doc.removeEventListener(NAVIGATION_EVENT, onNavigate);
        stopWatchingAd();
        stopWaitingForPlayer();
        if (playerObserver) playerObserver.disconnect();
        playerObserver = null;
        player = null;
      },
      /** Pour les tests : état interne des observateurs. */
      get debugState() {
        return { player, playerObserver: !!playerObserver, adObserver: !!adObserver, waitObserver: !!waitObserver, polling: pollTimer !== null };
      },
    };
  }

  /** Démarrage dans Chrome. */
  function main() {
    const skipper = new ns.AdSkipper({
      doc: document,
      onSkipped: () => console.info("[YouTube Ad Skip] publicité ignorée"),
    });
    const watcher = createAdWatcher({ doc: document, onCheck: (info) => skipper.handle(info) });
    watcher.start();
    ns.watcher = watcher;
  }

  ns.createAdWatcher = createAdWatcher;

  const inExtension = typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id;
  if (inExtension) main();
})(YtAdSkip);

if (typeof module !== "undefined" && module.exports) module.exports = YtAdSkip;
