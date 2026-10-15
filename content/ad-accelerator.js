// =============================================================================
// content/ad-accelerator.js — fonction expérimentale : publicités accélérées et muettes
// =============================================================================
//
// Rôle : pendant qu'une publicité s'affiche, passer la vidéo à la vitesse ×8 et couper le
// son ; à la fin de la publicité, rétablir la vitesse et le son d'origine.
//
// Utile surtout pour les publicités NON ignorables (sans bouton « Ignorer ») : elles ne
// sont pas supprimées, mais durent 8 fois moins longtemps. Activée uniquement si l'option
// « Fonctions expérimentales » est cochée (désactivée par défaut).
//
// Règles de sécurité :
//   - n'agit QUE lorsque le lecteur porte la classe « ad-showing » : une vidéo ordinaire
//     n'est jamais modifiée ;
//   - mémorise la vitesse et le son d'origine au début de la publicité ;
//   - au rétablissement, ne remet que ce que l'extension a changé (si YouTube a déjà
//     appliqué une autre vitesse, elle est conservée).
//
// Limite : le lecteur relève playbackRate et muted dans le rapport d'état qu'il établit à
// chaque événement de la vidéo (voir docs/verification-selecteurs.md). YouTube peut donc
// voir l'accélération. C'est pourquoi la fonction est désactivée par défaut.
// =============================================================================

// Espace de noms partagé entre les content scripts (voir detector.js).
var YtAdSkip = globalThis.YtAdSkip || (globalThis.YtAdSkip = {});

(function (ns) {
  "use strict";

  /** Vitesse appliquée pendant une publicité. Chrome accepte jusqu'à 16 ; 8 limite les saccades de chargement. */
  const AD_PLAYBACK_RATE = 8;

  /** Élément <video> principal du lecteur, vérifié dans base.js (g.V4.MAIN_VIDEO). */
  const MAIN_VIDEO_SELECTOR = "video.html5-main-video";

  /**
   * Renvoie l'élément <video> principal du lecteur, ou null.
   * Les publicités vidéo sont lues dans ce même élément que la vidéo normale.
   * @param {HTMLElement | null} player élément #movie_player
   * @returns {HTMLVideoElement | null}
   */
  function findMainVideo(player) {
    return player ? player.querySelector(MAIN_VIDEO_SELECTOR) : null;
  }

  class AdAccelerator {
    constructor() {
      /**
       * Valeurs d'origine de la vidéo modifiée : { video, rate, muted }, ou null si
       * l'extension n'a rien modifié. Sert à tout remettre en place à la fin.
       */
      this.saved = null;
    }

    /**
     * Réagit à un état renvoyé par YtAdSkip.getAdState(). Appelée par observer.js à chaque
     * changement du lecteur, et toutes les 500 ms pendant une publicité.
     * @param {{state: string, player: HTMLElement | null}} info
     */
    handle(info) {
      const adShowing = info.state === "ad-waiting" || info.state === "ad-skippable";
      // Plus de publicité (ou plus de lecteur) : rétablir la vidéo si on l'avait modifiée.
      if (!adShowing) return this.restore();

      const video = findMainVideo(info.player);
      if (!video) return; // structure inattendue : ne rien faire plutôt que d'échouer

      // YouTube a remplacé l'élément <video> : rétablir l'ancien avant de traiter le nouveau.
      if (this.saved && this.saved.video !== video) this.restore();

      // Première vérification de cette publicité : mémoriser les valeurs d'origine.
      if (!this.saved) this.saved = { video, rate: video.playbackRate, muted: video.muted };

      // Réappliqué à chaque vérification : le lecteur peut remettre la vitesse à 1 (vu dans base.js
      // pour certaines publicités), et une nouvelle publicité peut repartir à vitesse normale.
      // Les tests « !== » évitent d'écrire inutilement (chaque écriture déclenche un événement).
      if (video.playbackRate !== AD_PLAYBACK_RATE) video.playbackRate = AD_PLAYBACK_RATE;
      if (!video.muted) video.muted = true;
    }

    /**
     * Rétablit la vitesse et le son d'origine, sans écraser ce que YouTube a déjà rétabli.
     * Sans effet si l'extension n'a rien modifié. Appelée aussi quand l'utilisateur
     * désactive la fonction en pleine publicité.
     */
    restore() {
      if (!this.saved) return;
      const { video, rate, muted } = this.saved;
      this.saved = null;
      try {
        // Vitesse encore à ×8 : c'est la nôtre, on remet l'ancienne. Une autre valeur veut
        // dire que YouTube a déjà appliqué la vitesse choisie pour la vidéo : on n'y touche pas.
        if (video.playbackRate === AD_PLAYBACK_RATE) video.playbackRate = rate;
        // Ne rallumer le son que s'il était allumé avant la publicité : si l'utilisateur
        // avait coupé le son lui-même, il reste coupé.
        if (video.muted && !muted) video.muted = false;
      } catch (error) {
        console.warn("[YouTube Ad Skip] rétablissement de la vidéo impossible :", error);
      }
    }
  }

  // Partage avec les autres content scripts et les tests.
  Object.assign(ns, { AdAccelerator, findMainVideo, AD_PLAYBACK_RATE });
})(YtAdSkip);

// Export pour les tests Node. Dans Chrome, « module » n'existe pas : ce bloc est ignoré.
if (typeof module !== "undefined" && module.exports) module.exports = YtAdSkip;
