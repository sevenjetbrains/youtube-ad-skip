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

  const ENABLED_KEY = "enabled"; // réglage global, partagé avec la popup (chrome.storage.local)

  /**
   * Relie la surveillance aux réglages et à la popup.
   *   - démarre ou arrête la surveillance selon le réglage « enabled » (activé par défaut),
   *     y compris en pleine lecture lorsque l'utilisateur bascule l'interrupteur ;
   *   - signale chaque publicité réellement ignorée au service worker, qui tient les compteurs ;
   *   - répond à la popup qui demande l'état de l'onglet (« get-status »).
   * @param {{doc: Document, chromeApi: typeof chrome}} opts
   */
  function startContentScript({ doc, chromeApi }) {
    let enabled = false;

    function notify(message) {
      // Échoue si l'extension a été rechargée sans recharger l'onglet : sans conséquence.
      return Promise.resolve()
        .then(() => chromeApi.runtime.sendMessage(message))
        .catch((error) => console.warn("[YouTube Ad Skip] message non transmis :", error));
    }

    const skipper = new ns.AdSkipper({
      doc,
      bridge: { send: (message) => chromeApi.runtime.sendMessage(message) },
      onSkipped: () => {
        console.info("[YouTube Ad Skip] publicité ignorée");
        notify({ type: "ad-skipped" });
      },
    });
    const watcher = createAdWatcher({ doc, onCheck: (info) => enabled && skipper.handle(info) });

    function setEnabled(next) {
      if (next === enabled) return;
      enabled = next;
      if (enabled) {
        watcher.start();
      } else {
        watcher.stop();
        skipper.reset();
      }
    }

    chromeApi.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[ENABLED_KEY]) setEnabled(changes[ENABLED_KEY].newValue !== false);
    });
    chromeApi.storage.local.get({ [ENABLED_KEY]: true }).then(
      (values) => setEnabled(values[ENABLED_KEY] !== false),
      (error) => {
        console.warn("[YouTube Ad Skip] réglages illisibles, activation par défaut :", error);
        setEnabled(true);
      }
    );

    chromeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || message.type !== "get-status" || sender.id !== chromeApi.runtime.id) return false;
      let state = "unknown";
      try {
        state = ns.getAdState(doc).state;
      } catch (error) {
        console.warn("[YouTube Ad Skip] erreur de détection :", error);
      }
      sendResponse({ enabled, state });
      return false;
    });

    return { watcher, skipper, setEnabled, get enabled() { return enabled; } };
  }

  ns.createAdWatcher = createAdWatcher;
  ns.startContentScript = startContentScript;
  ns.ENABLED_KEY = ENABLED_KEY;

  const inExtension = typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id;
  if (inExtension) ns.contentScript = startContentScript({ doc: document, chromeApi: chrome });
})(YtAdSkip);

if (typeof module !== "undefined" && module.exports) module.exports = YtAdSkip;
