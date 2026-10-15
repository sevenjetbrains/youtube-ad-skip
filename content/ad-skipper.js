// =============================================================================
// content/ad-skipper.js — clic automatique sur « Ignorer » et vérification du résultat
// =============================================================================
//
// Rôle : quand detector.js signale une publicité avec un bouton « Ignorer » utilisable
// (état "ad-skippable"), demander un clic réel sur ce bouton, puis vérifier que la
// publicité a bien été quittée avant de la compter.
//
// Le clic lui-même est délégué au service worker (background.js), qui l'envoie via
// chrome.debugger : le lecteur YouTube ignore les clics simulés par script
// (event.isTrusted === false). Ce fichier se charge de tout le reste :
//   - éviter les clics répétés (une seule tentative à la fois, au plus 3 par publicité,
//     espacées d'au moins 1 seconde) ;
//   - recalculer la position du bouton juste avant le clic ;
//   - vérifier que rien ne recouvre le bouton (sinon le clic toucherait un autre élément) ;
//   - ne compter la publicité que si elle a réellement été quittée.
//
// Déroulement d'une tentative (voir clickSkipButton et verifySkipped) :
//   1. demande « debugger-attach » → Chrome affiche son bandeau, la page peut se décaler ;
//   2. attente de LAYOUT_SETTLE_MS, puis nouvelle détection du bouton et de sa position ;
//   3. demande « debugger-click » avec les coordonnées du centre du bouton ;
//   4. attente de VERIFY_DELAY_MS, puis vérification que le bouton a disparu ;
//   5. si oui : appel de onSkipped (compteurs), sinon nouvelle tentative plus tard.
// =============================================================================

// Espace de noms partagé entre les content scripts (voir detector.js).
var YtAdSkip = globalThis.YtAdSkip || (globalThis.YtAdSkip = {});

(function (ns) {
  "use strict";

  // --- Réglages internes -----------------------------------------------------

  /** Nombre maximal de clics par publicité ; au-delà, on abandonne jusqu'à la suivante. */
  const MAX_ATTEMPTS_PER_AD = 3;
  /** Délai minimal (ms) entre deux tentatives, pour ne pas mitrailler le bouton. */
  const RETRY_DELAY_MS = 1000;
  /** Attente (ms) après l'attachement : laisse le bandeau du débogueur décaler la page avant de mesurer. */
  const LAYOUT_SETTLE_MS = 150;
  /** Attente (ms) après le clic avant de vérifier que la publicité a bien été quittée. */
  const VERIFY_DELAY_MS = 1500;

  /** Renvoie une promesse résolue après « ms » millisecondes. */
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * Pont vers background.js : envoie un message au service worker et renvoie sa réponse.
   * Il est passé en paramètre à AdSkipper, ce qui permet aux tests de le remplacer par un
   * faux pont qui enregistre les messages sans Chrome.
   */
  const chromeClickBridge = {
    send(message) {
      return chrome.runtime.sendMessage(message);
    },
  };

  // --- Fonctions de géométrie ------------------------------------------------

  /**
   * Centre du bouton en pixels CSS, relatif au coin supérieur gauche de la zone d'affichage
   * (le même repère que celui attendu par Input.dispatchMouseEvent), ou null si le bouton
   * n'a pas de taille (pas encore affiché, ou masqué).
   * @param {Element} button
   * @returns {{x: number, y: number} | null}
   */
  function getClickPoint(button) {
    const rect = button.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  /**
   * Vrai si le bouton est bien l'élément situé tout en haut à ce point de l'écran.
   *
   * Un vrai clic touche l'élément visible au premier plan à ces coordonnées : si un menu,
   * une fenêtre ou une autre couche recouvre le bouton, le clic atteindrait cet autre
   * élément. elementFromPoint renvoie l'élément au premier plan ; il doit être le bouton
   * lui-même ou l'un de ses enfants (par exemple le texte « Ignorer » à l'intérieur).
   * @param {Element} button
   * @param {{x: number, y: number}} point
   */
  function isTopmostAt(button, point) {
    const hit = button.ownerDocument.elementFromPoint(point.x, point.y);
    return Boolean(hit && (hit === button || button.contains(hit)));
  }

  // --- Classe principale -----------------------------------------------------

  class AdSkipper {
    /**
     * @param {object} opts
     * @param {Document} opts.doc document de la page YouTube
     * @param {{send(message): Promise<object>}} [opts.bridge] pont vers background.js
     * @param {() => void} [opts.onSkipped] appelé quand une publicité a réellement été ignorée
     * @param {() => number} [opts.now] horloge (remplaçable dans les tests)
     * @param {{settle?: number, verify?: number}} [opts.delays] délais en ms (raccourcis dans les tests)
     */
    constructor({ doc, bridge = chromeClickBridge, onSkipped = () => {}, now = Date.now, delays = {} }) {
      this.doc = doc;
      this.bridge = bridge;
      this.onSkipped = onSkipped;
      this.now = now;
      this.settleDelay = delays.settle ?? LAYOUT_SETTLE_MS;
      this.verifyDelay = delays.verify ?? VERIFY_DELAY_MS;
      /** Vrai pendant une tentative : empêche d'en lancer une deuxième en parallèle. */
      this.busy = false;
      this.reset();
    }

    /** Oublie les tentatives en cours (nouvelle publicité, navigation, désactivation…). */
    reset() {
      /** Nombre de clics déjà tentés pour la publicité en cours. */
      this.attempts = 0;
      /** Moment (ms) de la dernière tentative ; -Infinity = aucune. */
      this.lastAttemptAt = -Infinity;
    }

    /**
     * Réagit à un état renvoyé par YtAdSkip.getAdState().
     * Appelée par observer.js à chaque changement du lecteur, et toutes les 500 ms pendant
     * une publicité : elle doit donc décider rapidement s'il faut agir ou non.
     * @param {{state: string, skipButton: HTMLButtonElement | null}} info
     * @returns {Promise<void>} résolue à la fin de la tentative éventuelle
     */
    async handle(info) {
      // Une tentative est déjà en cours (attente du bandeau ou de la vérification) :
      // ne pas en lancer une autre, sinon on cliquerait deux fois.
      if (this.busy) return;

      if (info.state !== "ad-skippable") {
        // Bouton absent ou masqué : la publicité suivante repartira de zéro.
        this.reset();
        return;
      }
      // Trop de tentatives sans effet pour cette publicité : on abandonne.
      if (this.attempts >= MAX_ATTEMPTS_PER_AD) return;
      // Dernière tentative trop récente : on attendra la vérification suivante.
      if (this.now() - this.lastAttemptAt < RETRY_DELAY_MS) return;

      this.busy = true;
      this.attempts += 1;
      this.lastAttemptAt = this.now();
      try {
        if (await this.clickSkipButton()) await this.verifySkipped(info.skipButton);
      } catch (error) {
        // Ex. : extension rechargée, service worker injoignable. La page n'est pas affectée.
        console.warn("[YouTube Ad Skip] échec du clic :", error);
      } finally {
        this.busy = false;
      }
    }

    /**
     * Envoie le vrai clic, en deux temps (attachement puis clic).
     * @returns {Promise<boolean>} true si le clic a été envoyé
     */
    async clickSkipButton() {
      // 1. Attacher le débogueur. Échec typique : une autre extension est déjà attachée.
      const attach = await this.bridge.send({ type: "debugger-attach" });
      if (!attach || !attach.ok) {
        console.warn("[YouTube Ad Skip] débogueur indisponible :", attach && attach.error);
        return false;
      }

      // 2. Laisser le bandeau du débogueur s'afficher et décaler la page.
      await wait(this.settleDelay);

      // 3. Re-vérifier après le délai : la publicité a pu se terminer entre-temps, ou le
      //    bouton a pu bouger. On mesure sa position seulement maintenant.
      const { state, skipButton } = ns.getAdState(this.doc);
      const point = state === "ad-skippable" ? getClickPoint(skipButton) : null;
      if (!point || !isTopmostAt(skipButton, point)) {
        // Plus de bouton, ou bouton recouvert : on renonce et on libère le débogueur.
        await this.bridge.send({ type: "debugger-detach" });
        return false;
      }

      // 4. Demander le clic au centre du bouton (background.js détache ensuite le débogueur).
      const click = await this.bridge.send({ type: "debugger-click", x: point.x, y: point.y });
      if (!click || !click.ok) {
        console.warn("[YouTube Ad Skip] clic refusé :", click && click.error);
        return false;
      }
      return true;
    }

    /**
     * Compte la publicité comme ignorée seulement si, après un délai, le bouton cliqué a
     * disparu ou si la publicité est finie. Un clic sans effet n'est pas compté : les
     * statistiques reflètent les actions réellement réussies.
     * @param {HTMLButtonElement} button bouton sur lequel on a cliqué
     */
    async verifySkipped(button) {
      await wait(this.verifyDelay);
      const after = ns.getAdState(this.doc);
      // Le MÊME bouton est encore utilisable : le clic n'a pas fonctionné.
      // (Un bouton différent signifie qu'on est passé à la publicité suivante.)
      const stillThere = after.state === "ad-skippable" && after.skipButton === button;
      if (stillThere) return;
      this.reset(); // la publicité suivante dispose de nouveau de toutes ses tentatives
      this.onSkipped();
    }
  }

  // Partage avec les autres content scripts et les tests.
  Object.assign(ns, {
    AdSkipper,
    getClickPoint,
    isTopmostAt,
    MAX_ATTEMPTS_PER_AD,
    RETRY_DELAY_MS,
    VERIFY_DELAY_MS,
  });
})(YtAdSkip);

// Export pour les tests Node. Dans Chrome, « module » n'existe pas : ce bloc est ignoré.
if (typeof module !== "undefined" && module.exports) module.exports = YtAdSkip;
