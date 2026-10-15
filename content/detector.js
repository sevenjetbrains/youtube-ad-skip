// =============================================================================
// content/detector.js — détection de l'état publicitaire du lecteur YouTube
// =============================================================================
//
// Rôle : répondre à la question « que se passe-t-il dans le lecteur en ce moment ? »
//   - y a-t-il un lecteur vidéo sur la page ?
//   - diffuse-t-il une publicité ?
//   - le bouton « Ignorer » est-il disponible (présent, visible et activé) ?
//
// Ce fichier ne fait que LIRE la page : il ne clique sur rien et ne modifie rien.
// Les autres fichiers (ad-skipper.js, ad-accelerator.js, observer.js) s'appuient sur
// getAdState(), sa fonction principale.
//
// Organisation des content scripts :
//   Les content scripts ne sont pas des modules ES (pas d'import/export). Chrome les exécute
//   l'un après l'autre, dans l'ordre de la liste « js » du manifest, dans un même
//   environnement isolé de la page. Ils partagent donc leurs fonctions par un objet global
//   commun, YtAdSkip (abrégé « ns », pour namespace, dans chaque fichier).
//
// Sélecteurs vérifiés dans le code du lecteur YouTube (base.js, version 22cb88bc,
// octobre 2026) — voir docs/verification-selecteurs.md :
//   - le lecteur est #movie_player ;
//   - le lecteur porte la classe « ad-showing » pendant une publicité ;
//   - les publicités sont rendues dans div.video-ads.ytp-ad-module ;
//   - le bouton « Ignorer » est un <button> portant l'une des classes de SKIP_BUTTON_CLASSES.
// =============================================================================

// Crée l'espace de noms partagé s'il n'existe pas encore, ou réutilise celui créé par un
// fichier chargé avant. « var » (et non « const ») permet la redéclaration dans chaque fichier.
var YtAdSkip = globalThis.YtAdSkip || (globalThis.YtAdSkip = {});

// Fonction immédiatement exécutée : les constantes et fonctions internes ne polluent pas
// l'espace global ; seules celles copiées dans « ns » à la fin sont partagées.
(function (ns) {
  "use strict";

  // --- Constantes ------------------------------------------------------------

  // On cherche le lecteur uniquement par son id. La classe .html5-video-player est aussi
  // portée par le petit lecteur d'aperçu qui joue au survol des miniatures : il ne doit
  // pas être surveillé.
  const PLAYER_ID = "movie_player";

  // Classe ajoutée par YouTube sur #movie_player au début de chaque publicité et retirée à
  // la fin. C'est le signal le plus fiable de l'état publicitaire.
  const AD_SHOWING_CLASS = "ad-showing";

  // Classes possibles du bouton « Ignorer », de la plus récente à la plus ancienne :
  // YouTube garde plusieurs variantes dans son code et peut afficher l'une ou l'autre.
  const SKIP_BUTTON_CLASSES = ["ytp-skip-ad-button", "ytp-ad-skip-button-modern", "ytp-ad-skip-button"];

  // Sélecteur CSS combiné : "button.ytp-skip-ad-button, button.ytp-ad-skip-button-modern, …".
  // Le préfixe « button. » écarte tout élément qui ne serait pas un vrai bouton.
  const SKIP_BUTTON_SELECTOR = SKIP_BUTTON_CLASSES.map((c) => "button." + c).join(", ");

  // --- Fonctions élémentaires ------------------------------------------------

  /**
   * Renvoie l'élément du lecteur vidéo principal, ou null s'il n'y en a pas
   * (page d'accueil, résultats de recherche, page de chaîne…).
   * @param {Document} doc
   * @returns {HTMLElement | null}
   */
  function findPlayer(doc) {
    return doc.getElementById(PLAYER_ID);
  }

  /**
   * Vrai si le lecteur est en train de diffuser une publicité.
   * @param {HTMLElement | null} player
   */
  function isAdShowing(player) {
    return Boolean(player && player.classList.contains(AD_SHOWING_CLASS));
  }

  /**
   * Vrai si l'élément est réellement affiché : ni lui ni aucun de ses ancêtres n'est masqué.
   *
   * YouTube insère souvent le bouton « Ignorer » dans la page bien avant qu'il soit
   * utilisable (pendant le compte à rebours de 5 secondes), en le masquant : sa simple
   * présence dans le DOM ne suffit donc pas.
   * @param {Element | null} el
   */
  function isElementVisible(el) {
    // Élément absent ou retiré de la page.
    if (!el || !el.isConnected) return false;

    // API native de Chrome : tient compte de display, visibility et opacity, sur l'élément
    // ET sur ses ancêtres, en une seule fois.
    if (typeof el.checkVisibility === "function") {
      return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    }

    // Repli pour les environnements sans checkVisibility (jsdom, utilisé par les tests) :
    // on remonte l'arbre jusqu'à la racine en vérifiant le style calculé de chaque élément.
    const view = el.ownerDocument.defaultView;
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      if (node.hidden) return false;
      const style = view.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    }
    return true;
  }

  /**
   * Vrai si le bouton peut être actionné : ni désactivé (attribut disabled), ni signalé
   * comme désactivé aux technologies d'assistance (aria-disabled="true").
   * @param {HTMLElement} el
   */
  function isElementEnabled(el) {
    return !el.disabled && el.getAttribute("aria-disabled") !== "true";
  }

  /**
   * Vrai si l'élément est bien un bouton « Ignorer » de publicité situé DANS le lecteur donné.
   *
   * Ces vérifications garantissent que l'extension ne clique jamais sur un autre bouton :
   * balise <button> obligatoire, classe de bouton « Ignorer » obligatoire, et position à
   * l'intérieur de #movie_player (un élément homonyme ailleurs dans la page est écarté).
   * On ne s'appuie pas sur le texte « Ignorer », qui vient du serveur et dépend de la langue.
   * @param {Element | null} el
   * @param {HTMLElement | null} player
   */
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
   *
   * Ne renvoie jamais rien hors publicité : un bouton résiduel laissé dans la page après
   * une publicité ne doit pas être cliqué pendant une vidéo ordinaire.
   * @param {HTMLElement | null} player
   * @returns {HTMLButtonElement | null}
   */
  function findUsableSkipButton(player) {
    if (!isAdShowing(player)) return null;
    // Plusieurs boutons peuvent exister (variantes, restes d'une publicité précédente) :
    // on prend le premier qui remplit toutes les conditions.
    for (const el of player.querySelectorAll(SKIP_BUTTON_SELECTOR)) {
      if (isSkipButton(el, player) && isElementVisible(el) && isElementEnabled(el)) return el;
    }
    return null;
  }

  // --- Fonction principale ---------------------------------------------------

  /**
   * Résume l'état du lecteur. Valeurs possibles de « state » :
   *   - "no-player"   : pas de lecteur sur la page (accueil, recherche…) ;
   *   - "no-ad"       : vidéo ordinaire ;
   *   - "ad-waiting"  : publicité sans bouton « Ignorer » disponible (pas encore, ou jamais) ;
   *   - "ad-skippable": publicité avec bouton « Ignorer » utilisable.
   *
   * L'objet renvoyé contient aussi le lecteur et le bouton trouvés, pour que les autres
   * fichiers n'aient pas à les chercher de nouveau.
   * @param {Document} doc
   * @returns {{state: string, player: HTMLElement | null, skipButton: HTMLButtonElement | null}}
   */
  function getAdState(doc) {
    const player = findPlayer(doc);
    if (!player) return { state: "no-player", player: null, skipButton: null };
    if (!isAdShowing(player)) return { state: "no-ad", player, skipButton: null };
    const skipButton = findUsableSkipButton(player);
    return { state: skipButton ? "ad-skippable" : "ad-waiting", player, skipButton };
  }

  // Partage des constantes et fonctions avec les autres content scripts (et les tests).
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

// Export pour les tests Node. Dans Chrome, « module » n'existe pas : ce bloc est ignoré.
if (typeof module !== "undefined" && module.exports) module.exports = YtAdSkip;
