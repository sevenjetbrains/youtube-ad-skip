// Détection de l'état publicitaire du lecteur YouTube.
// Les content scripts ne sont pas des modules ES : les fichiers de content/
// partagent l'espace de noms YtAdSkip et sont chargés dans l'ordre du manifest.
//
// Sélecteurs vérifiés dans le code du lecteur YouTube (base.js, version 22cb88bc,
// octobre 2026) — voir docs/verification-selecteurs.md :
//   - le lecteur est #movie_player ;
//   - le lecteur porte la classe « ad-showing » pendant une publicité ;
//   - les publicités sont rendues dans div.video-ads.ytp-ad-module ;
//   - le bouton « Ignorer » est un <button> portant l'une des classes de SKIP_BUTTON_CLASSES.
var YtAdSkip = globalThis.YtAdSkip || (globalThis.YtAdSkip = {});

(function (ns) {
  "use strict";

  // Uniquement l'id : la classe .html5-video-player est aussi portée par le lecteur
  // d'aperçu au survol des miniatures, qui ne doit pas être surveillé.
  const PLAYER_ID = "movie_player";
  const AD_SHOWING_CLASS = "ad-showing";

  // Du plus récent au plus ancien : YouTube garde plusieurs variantes en parallèle.
  const SKIP_BUTTON_CLASSES = ["ytp-skip-ad-button", "ytp-ad-skip-button-modern", "ytp-ad-skip-button"];
  const SKIP_BUTTON_SELECTOR = SKIP_BUTTON_CLASSES.map((c) => "button." + c).join(", ");

  /** Renvoie l'élément du lecteur vidéo principal, ou null. */
  function findPlayer(doc) {
    return doc.getElementById(PLAYER_ID);
  }

  /** Vrai si le lecteur est en train de diffuser une publicité. */
  function isAdShowing(player) {
    return Boolean(player && player.classList.contains(AD_SHOWING_CLASS));
  }

  /** Vrai si l'élément est affiché : il n'est ni lui-même ni via un ancêtre masqué. */
  function isElementVisible(el) {
    if (!el || !el.isConnected) return false;
    // API native de Chrome : tient compte de display, visibility et opacity.
    if (typeof el.checkVisibility === "function") {
      return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    }
    // Repli (environnements sans checkVisibility, ex. jsdom).
    const view = el.ownerDocument.defaultView;
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      if (node.hidden) return false;
      const style = view.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    }
    return true;
  }

  /** Vrai si le bouton peut être actionné. */
  function isElementEnabled(el) {
    return !el.disabled && el.getAttribute("aria-disabled") !== "true";
  }

  /** Vrai si l'élément est bien un bouton « Ignorer » de publicité situé dans le lecteur donné. */
  function isSkipButton(el, player) {
    return Boolean(
      el &&
        el.tagName === "BUTTON" &&
        SKIP_BUTTON_CLASSES.some((c) => el.classList.contains(c)) &&
        player &&
        player.contains(el)
    );
  }

  /**
   * Renvoie le bouton « Ignorer » utilisable (visible et activé), ou null.
   * Ne renvoie jamais rien hors publicité, pour ne pas toucher aux vidéos ordinaires.
   */
  function findUsableSkipButton(player) {
    if (!isAdShowing(player)) return null;
    for (const el of player.querySelectorAll(SKIP_BUTTON_SELECTOR)) {
      if (isSkipButton(el, player) && isElementVisible(el) && isElementEnabled(el)) return el;
    }
    return null;
  }

  /**
   * Résume l'état du lecteur :
   *   - "no-player"   : pas de lecteur sur la page (accueil, recherche…) ;
   *   - "no-ad"       : vidéo ordinaire ;
   *   - "ad-waiting"  : publicité sans bouton « Ignorer » disponible (pas encore, ou jamais) ;
   *   - "ad-skippable": publicité avec bouton « Ignorer » utilisable.
   */
  function getAdState(doc) {
    const player = findPlayer(doc);
    if (!player) return { state: "no-player", player: null, skipButton: null };
    if (!isAdShowing(player)) return { state: "no-ad", player, skipButton: null };
    const skipButton = findUsableSkipButton(player);
    return { state: skipButton ? "ad-skippable" : "ad-waiting", player, skipButton };
  }

  Object.assign(ns, {
    PLAYER_ID,
    AD_SHOWING_CLASS,
    SKIP_BUTTON_CLASSES,
    SKIP_BUTTON_SELECTOR,
    findPlayer,
    isAdShowing,
    isElementVisible,
    isElementEnabled,
    isSkipButton,
    findUsableSkipButton,
    getAdState,
  });
})(YtAdSkip);

// Export pour les tests Node (absent dans Chrome).
if (typeof module !== "undefined" && module.exports) module.exports = YtAdSkip;
