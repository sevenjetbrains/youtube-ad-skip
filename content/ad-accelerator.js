// Fonction expérimentale : accélère et coupe le son des publicités pendant qu'elles s'affichent.
//
// Utile surtout pour les publicités non ignorables. Elle agit uniquement quand le lecteur
// porte la classe « ad-showing » et rétablit la vitesse et le son à la fin de la publicité.
//
// Limite : le lecteur relève playbackRate et muted dans le rapport d'état qu'il établit à
// chaque événement de la vidéo (voir docs/verification-selecteurs.md). YouTube peut donc
// voir l'accélération. C'est pourquoi la fonction est désactivée par défaut.
var YtAdSkip = globalThis.YtAdSkip || (globalThis.YtAdSkip = {});

(function (ns) {
  "use strict";

  const AD_PLAYBACK_RATE = 8; // Chrome accepte jusqu'à 16 ; 8 limite les saccades de chargement
  const MAIN_VIDEO_SELECTOR = "video.html5-main-video"; // vérifié dans base.js (g.V4.MAIN_VIDEO)

  /** Renvoie l'élément <video> principal du lecteur, ou null. */
  function findMainVideo(player) {
    return player ? player.querySelector(MAIN_VIDEO_SELECTOR) : null;
  }

  class AdAccelerator {
    constructor() {
      /** Valeurs d'origine de la vidéo modifiée : { video, rate, muted }, ou null. */
      this.saved = null;
    }

    /** Réagit à un état renvoyé par YtAdSkip.getAdState(). */
    handle(info) {
      const adShowing = info.state === "ad-waiting" || info.state === "ad-skippable";
      if (!adShowing) return this.restore();

      const video = findMainVideo(info.player);
      if (!video) return;
      if (this.saved && this.saved.video !== video) this.restore(); // élément remplacé par YouTube
      if (!this.saved) this.saved = { video, rate: video.playbackRate, muted: video.muted };
      // Réappliqué à chaque vérification : le lecteur peut remettre la vitesse à 1 (vu dans base.js
      // pour certaines publicités), et une nouvelle publicité peut repartir à vitesse normale.
      if (video.playbackRate !== AD_PLAYBACK_RATE) video.playbackRate = AD_PLAYBACK_RATE;
      if (!video.muted) video.muted = true;
    }

    /** Rétablit la vitesse et le son d'origine, sans écraser ce que YouTube a déjà rétabli. */
    restore() {
      if (!this.saved) return;
      const { video, rate, muted } = this.saved;
      this.saved = null;
      try {
        if (video.playbackRate === AD_PLAYBACK_RATE) video.playbackRate = rate;
        if (video.muted && !muted) video.muted = false;
      } catch (error) {
        console.warn("[YouTube Ad Skip] rétablissement de la vidéo impossible :", error);
      }
    }
  }

  Object.assign(ns, { AdAccelerator, findMainVideo, AD_PLAYBACK_RATE });
})(YtAdSkip);

if (typeof module !== "undefined" && module.exports) module.exports = YtAdSkip;
