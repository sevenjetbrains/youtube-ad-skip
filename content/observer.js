// =============================================================================
// content/observer.js — point d'entrée du content script
// =============================================================================
//
// Ce fichier est chargé en DERNIER (voir l'ordre « js » du manifest) : il utilise les
// fonctions des fichiers précédents et démarre l'extension dans la page YouTube.
//
// Il contient deux parties :
//
//   1. createAdWatcher : la SURVEILLANCE du lecteur. Elle repère les changements utiles
//      (début et fin de publicité, apparition du bouton « Ignorer », navigation vers une
//      autre vidéo) et appelle alors une fonction de vérification.
//
//   2. startContentScript : le CHEF D'ORCHESTRE. Il lit les réglages, démarre ou arrête la
//      surveillance selon ces réglages, transmet chaque état du lecteur au clic automatique
//      (ad-skipper.js) et à la fonction expérimentale (ad-accelerator.js), prévient le
//      service worker des publicités ignorées et répond à la popup.
//
// Stratégie de surveillance économe en ressources (exigence du cahier des charges) :
//   - hors publicité : un seul MutationObserver, limité à l'attribut « class » de
//     #movie_player. Il ne se déclenche que lorsque YouTube change les classes du lecteur,
//     ce qui arrive notamment au début d'une publicité (ajout de « ad-showing ») ;
//   - pendant une publicité seulement : observation du conteneur .video-ads (apparition du
//     bouton « Ignorer ») et vérification de secours toutes les 500 ms ;
//   - tant que le lecteur n'existe pas (accueil, recherche…) : un observateur attend son
//     apparition, puis se déconnecte.
//   Aucune boucle permanente ne tourne pendant une vidéo ordinaire.
// =============================================================================

// Espace de noms partagé entre les content scripts (voir detector.js).
var YtAdSkip = globalThis.YtAdSkip || (globalThis.YtAdSkip = {});

(function (ns) {
  "use strict";

  /** Intervalle (ms) de la vérification de secours, pendant une publicité uniquement. */
  const AD_POLL_INTERVAL_MS = 500;
  /** Conteneur dans lequel YouTube affiche les éléments de la publicité (dont le bouton). */
  const AD_CONTAINER_SELECTOR = ".video-ads";
  /**
   * Événement émis par l'application YouTube à la fin d'une navigation interne (clic sur une
   * autre vidéo sans rechargement de la page). Vérifié dans le code de l'application YouTube.
   */
  const NAVIGATION_EVENT = "yt-navigate-finish";

  // ===========================================================================
  // 1. Surveillance du lecteur
  // ===========================================================================

  /**
   * Surveille le lecteur et appelle onCheck(getAdState(doc)) à chaque changement pertinent.
   *
   * Les appels sont regroupés : plusieurs mutations rapprochées (YouTube modifie souvent
   * des dizaines d'éléments à la fois) donnent une seule vérification.
   *
   * @param {object} opts
   * @param {Document} opts.doc document de la page
   * @param {(info: ReturnType<typeof ns.getAdState>) => void} opts.onCheck appelée avec l'état du lecteur
   * @returns {{start(): void, stop(): void, debugState: object}}
   */
  function createAdWatcher({ doc, onCheck }) {
    // Fenêtre de la page : donne accès à MutationObserver et aux minuteurs du bon document
    // (important pour les tests, où le document vient de jsdom et non de Chrome).
    const view = doc.defaultView;

    let player = null; // #movie_player actuellement surveillé, ou null
    let playerObserver = null; // observe la classe du lecteur
    let adObserver = null; // observe le conteneur de la publicité (pendant une publicité)
    let waitObserver = null; // attend l'apparition du lecteur (pages sans lecteur)
    let pollTimer = null; // vérification de secours (pendant une publicité)
    let scheduled = false; // une vérification est déjà programmée
    let running = false; // la surveillance est démarrée

    /**
     * Programme une vérification au prochain tour de la boucle d'événements.
     * Si une vérification est déjà programmée, ne fait rien : c'est le regroupement.
     */
    function scheduleCheck() {
      if (!running || scheduled) return;
      scheduled = true;
      view.setTimeout(runCheck, 0);
    }

    /** Effectue la vérification : lit l'état, adapte les observateurs, prévient onCheck. */
    function runCheck() {
      scheduled = false;
      if (!running) return; // arrêtée entre-temps
      try {
        const info = ns.getAdState(doc);
        watchPlayer(info.player); // le lecteur a pu apparaître, disparaître ou être remplacé
        watchAd(info.state === "ad-waiting" || info.state === "ad-skippable");
        onCheck(info);
      } catch (error) {
        // Une erreur de détection ne doit jamais casser la page : on journalise et on continue.
        console.warn("[YouTube Ad Skip] erreur de détection :", error);
      }
    }

    /**
     * Place l'observateur de classe sur le lecteur donné (ou attend un lecteur s'il n'y en a pas).
     * @param {HTMLElement | null} next lecteur trouvé lors de la vérification
     */
    function watchPlayer(next) {
      if (next === player) {
        if (!player) waitForPlayer(); // démarrage sur une page sans lecteur
        return; // même lecteur qu'avant : les observateurs sont déjà en place
      }
      // Lecteur différent (ou disparu) : on abandonne tout ce qui concernait l'ancien.
      stopWatchingAd();
      if (playerObserver) playerObserver.disconnect();
      playerObserver = null;
      player = next;
      if (player) {
        stopWaitingForPlayer();
        playerObserver = new view.MutationObserver(scheduleCheck);
        // attributeFilter limite l'observation à l'attribut « class » : les autres
        // changements du lecteur (très fréquents) ne déclenchent rien.
        playerObserver.observe(player, { attributes: true, attributeFilter: ["class"] });
      } else {
        waitForPlayer();
      }
    }

    /**
     * Attend qu'un lecteur apparaisse dans la page (navigation de l'accueil vers une vidéo).
     * Cet observateur surveille tout le document, mais il est retiré dès que le lecteur existe.
     */
    function waitForPlayer() {
      if (waitObserver) return;
      waitObserver = new view.MutationObserver(() => {
        if (ns.findPlayer(doc)) scheduleCheck(); // getElementById : recherche très rapide
      });
      waitObserver.observe(doc.documentElement, { childList: true, subtree: true });
    }

    function stopWaitingForPlayer() {
      if (waitObserver) waitObserver.disconnect();
      waitObserver = null;
    }

    /**
     * Active ou désactive la surveillance renforcée réservée aux publicités.
     * @param {boolean} active vrai si une publicité est en cours
     */
    function watchAd(active) {
      if (!active) return stopWatchingAd();
      if (adObserver) return; // déjà en place pour cette publicité
      // Repli sur le lecteur entier si YouTube a renommé ou retiré le conteneur.
      const container = player.querySelector(AD_CONTAINER_SELECTOR) || player;
      adObserver = new view.MutationObserver(scheduleCheck);
      adObserver.observe(container, {
        childList: true, // ajout ou retrait d'éléments (ex. : insertion du bouton)
        subtree: true, // dans tout le conteneur, pas seulement ses enfants directs
        attributes: true,
        // Seuls les attributs qui peuvent rendre le bouton visible ou utilisable.
        attributeFilter: ["style", "class", "hidden", "disabled", "aria-disabled"],
      });
      // Secours : une transition CSS (opacité) ne produit pas toujours de mutation.
      pollTimer = view.setInterval(scheduleCheck, AD_POLL_INTERVAL_MS);
    }

    /** Retire l'observateur de publicité et le minuteur de secours. */
    function stopWatchingAd() {
      if (adObserver) adObserver.disconnect();
      adObserver = null;
      if (pollTimer !== null) view.clearInterval(pollTimer);
      pollTimer = null;
    }

    /** Navigation interne terminée : le lecteur a pu changer de vidéo, on revérifie. */
    function onNavigate() {
      scheduleCheck();
    }

    return {
      /** Démarre la surveillance (sans effet si elle tourne déjà). */
      start() {
        if (running) return;
        running = true;
        doc.addEventListener(NAVIGATION_EVENT, onNavigate);
        scheduleCheck(); // première vérification immédiate
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

  // ===========================================================================
  // 2. Démarrage et lien avec les réglages, le service worker et la popup
  // ===========================================================================

  /** Module de réglages (common/settings.js), chargé avant ce fichier par le manifest. */
  const Settings = globalThis.YtAdSkipSettings;

  /**
   * Relie la surveillance aux réglages et à la popup.
   *   - applique les réglages enregistrés (activation globale, clic automatique, fonction
   *     expérimentale) au chargement et dès qu'ils changent, y compris en pleine lecture ;
   *   - signale chaque publicité réellement ignorée au service worker, qui tient les compteurs ;
   *   - répond à la popup qui demande l'état de l'onglet (« get-status »).
   *
   * L'API chrome est passée en paramètre (chromeApi) pour que les tests puissent fournir
   * une fausse API.
   * @param {{doc: Document, chromeApi: typeof chrome}} opts
   */
  function startContentScript({ doc, chromeApi }) {
    let settings = null; // null tant que les réglages ne sont pas lus
    /** Vrai si les réglages demandent de surveiller le lecteur. */
    const isActive = () => Boolean(settings && Settings.isActive(settings));

    /**
     * Envoie un message au service worker sans attendre ni propager d'erreur.
     * Échoue si l'extension a été rechargée sans recharger l'onglet : sans conséquence.
     */
    function notify(message) {
      return Promise.resolve()
        .then(() => chromeApi.runtime.sendMessage(message))
        .catch((error) => console.warn("[YouTube Ad Skip] message non transmis :", error));
    }

    // Clic automatique : il passe par le service worker pour le vrai clic (voir background.js).
    const skipper = new ns.AdSkipper({
      doc,
      bridge: { send: (message) => chromeApi.runtime.sendMessage(message) },
      onSkipped: () => {
        console.info("[YouTube Ad Skip] publicité ignorée");
        notify({ type: "ad-skipped" }); // le service worker incrémente les compteurs
      },
    });
    // Fonction expérimentale (utilisée seulement si l'option est cochée).
    const accelerator = new ns.AdAccelerator();

    /**
     * Vrai si l'extension a été rechargée, mise à jour ou désinstallée depuis l'injection de ce
     * script : Chrome ne le retire pas de l'onglet, mais il n'a plus accès à l'extension
     * (chrome.runtime.id devient undefined). Il ne doit alors plus agir sur le lecteur.
     */
    const isOrphaned = () => !chromeApi.runtime || !chromeApi.runtime.id;

    /**
     * Appelée par la surveillance à chaque changement du lecteur.
     * Transmet l'état aux fonctions activées dans les réglages.
     */
    function onCheck(info) {
      if (!isActive()) return;
      if (isOrphaned()) return shutDown();
      // L'accélération passe d'abord : si les deux fonctions sont actives, la publicité est
      // accélérée en attendant que le bouton « Ignorer » apparaisse, puis ignorée.
      if (settings.experimental) accelerator.handle(info);
      if (settings.autoSkip) skipper.handle(info);
    }
    const watcher = createAdWatcher({ doc, onCheck });

    /** Arrêt définitif : vidéo rétablie, surveillance libérée. L'onglet devra être rechargé. */
    function shutDown() {
      console.info("[YouTube Ad Skip] extension rechargée : rechargez l'onglet pour la réactiver");
      applySettings({ enabled: false });
    }

    /**
     * Applique de nouveaux réglages : démarre ou arrête la surveillance, et annule
     * immédiatement l'effet d'une fonction qui vient d'être désactivée.
     * @param {object} next réglages (complétés par les valeurs par défaut si besoin)
     */
    function applySettings(next) {
      const wasActive = isActive();
      settings = Settings.normalizeSettings(next);
      // Fonction expérimentale coupée en pleine publicité : vitesse et son rétablis tout de suite.
      if (!settings.enabled || !settings.experimental) accelerator.restore();
      // Clic automatique coupé : oublier les tentatives en cours.
      if (!settings.enabled || !settings.autoSkip) skipper.reset();
      // Démarrer ou arrêter la surveillance seulement si son utilité a changé.
      if (isActive() && !wasActive) watcher.start();
      if (!isActive() && wasActive) watcher.stop();
    }

    // Réglages modifiés dans la popup ou la page d'options : Chrome prévient tous les onglets.
    chromeApi.storage.onChanged.addListener((changes, area) => {
      if (!settings) return; // la lecture initiale, postérieure, verra déjà la nouvelle valeur
      const next = Settings.applySettingChanges(settings, changes, area);
      if (next) applySettings(next); // null = changement sans rapport (ex. : compteurs)
    });

    // Lecture initiale des réglages enregistrés. En cas d'échec, valeurs par défaut.
    Settings.loadSettings(chromeApi.storage.local).then(applySettings, (error) => {
      console.warn("[YouTube Ad Skip] réglages illisibles, valeurs par défaut :", error);
      applySettings(Settings.DEFAULT_SETTINGS);
    });

    // Question de la popup : « que se passe-t-il dans cet onglet ? ».
    chromeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
      // On ne répond qu'à notre propre extension, et seulement à ce type de message.
      if (!message || message.type !== "get-status" || sender.id !== chromeApi.runtime.id) return false;
      let state = "unknown";
      try {
        state = ns.getAdState(doc).state;
      } catch (error) {
        console.warn("[YouTube Ad Skip] erreur de détection :", error);
      }
      sendResponse({ enabled: isActive(), state });
      return false; // réponse envoyée immédiatement (synchrone)
    });

    // Accès pour les tests (et le débogage depuis la console).
    return {
      watcher,
      skipper,
      accelerator,
      applySettings,
      shutDown,
      get settings() {
        return settings;
      },
      get enabled() {
        return isActive();
      },
    };
  }

  ns.createAdWatcher = createAdWatcher;
  ns.startContentScript = startContentScript;

  // Démarrage automatique, uniquement dans Chrome. Dans les tests Node, « chrome » n'existe
  // pas : les tests appellent eux-mêmes startContentScript avec une fausse API.
  const inExtension = typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id;
  if (inExtension) ns.contentScript = startContentScript({ doc: document, chromeApi: chrome });
})(YtAdSkip);

// Export pour les tests Node. Dans Chrome, « module » n'existe pas : ce bloc est ignoré.
if (typeof module !== "undefined" && module.exports) module.exports = YtAdSkip;
