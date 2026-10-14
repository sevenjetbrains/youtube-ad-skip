// Clic automatique sur le bouton « Ignorer » et vérification du résultat.
//
// Le clic lui-même est délégué au service worker (background.js), qui envoie un vrai clic
// via chrome.debugger : le lecteur YouTube ignore les clics simulés (isTrusted === false).
var YtAdSkip = globalThis.YtAdSkip || (globalThis.YtAdSkip = {});

(function (ns) {
  "use strict";

  const MAX_ATTEMPTS_PER_AD = 3; // au-delà, on abandonne jusqu'à la publicité suivante
  const RETRY_DELAY_MS = 1000; // délai minimal entre deux tentatives
  const LAYOUT_SETTLE_MS = 150; // laisse le bandeau du débogueur décaler la page avant de mesurer
  const VERIFY_DELAY_MS = 1500; // délai avant de vérifier que la publicité a bien été quittée

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** Pont vers background.js. Remplaçable dans les tests. */
  const chromeClickBridge = {
    send(message) {
      return chrome.runtime.sendMessage(message);
    },
  };

  /** Centre du bouton en pixels CSS relatifs à la fenêtre, ou null s'il n'a pas de taille. */
  function getClickPoint(button) {
    const rect = button.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  /** Vrai si le bouton est bien l'élément cliqué à ce point (rien ne le recouvre). */
  function isTopmostAt(button, point) {
    const hit = button.ownerDocument.elementFromPoint(point.x, point.y);
    return Boolean(hit && (hit === button || button.contains(hit)));
  }

  class AdSkipper {
    /**
     * @param {object} opts
     * @param {Document} opts.doc
     * @param {{send(message): Promise<object>}} [opts.bridge] pont vers background.js
     * @param {() => void} [opts.onSkipped] appelé quand une publicité a réellement été ignorée
     * @param {() => number} [opts.now]
     * @param {{settle?: number, verify?: number}} [opts.delays] délais en ms (raccourcis dans les tests)
     */
    constructor({ doc, bridge = chromeClickBridge, onSkipped = () => {}, now = Date.now, delays = {} }) {
      this.doc = doc;
      this.bridge = bridge;
      this.onSkipped = onSkipped;
      this.now = now;
      this.settleDelay = delays.settle ?? LAYOUT_SETTLE_MS;
      this.verifyDelay = delays.verify ?? VERIFY_DELAY_MS;
      this.busy = false;
      this.reset();
    }

    /** Oublie les tentatives en cours (nouvelle publicité, navigation…). */
    reset() {
      this.attempts = 0;
      this.lastAttemptAt = -Infinity;
    }

    /**
     * Réagit à un état renvoyé par YtAdSkip.getAdState().
     * Renvoie une promesse résolue à la fin de la tentative éventuelle.
     */
    async handle(info) {
      if (this.busy) return;
      if (info.state !== "ad-skippable") {
        // Bouton absent ou masqué : la publicité suivante repartira de zéro.
        this.reset();
        return;
      }
      if (this.attempts >= MAX_ATTEMPTS_PER_AD) return;
      if (this.now() - this.lastAttemptAt < RETRY_DELAY_MS) return;

      this.busy = true;
      this.attempts += 1;
      this.lastAttemptAt = this.now();
      try {
        if (await this.clickSkipButton()) await this.verifySkipped(info.skipButton);
      } catch (error) {
        console.warn("[YouTube Ad Skip] échec du clic :", error);
      } finally {
        this.busy = false;
      }
    }

    /** Envoie le vrai clic. Renvoie true si le clic a été envoyé. */
    async clickSkipButton() {
      const attach = await this.bridge.send({ type: "debugger-attach" });
      if (!attach || !attach.ok) {
        console.warn("[YouTube Ad Skip] débogueur indisponible :", attach && attach.error);
        return false;
      }
      await wait(this.settleDelay);

      // Re-vérifier après le délai : la publicité a pu se terminer entre-temps.
      const { state, skipButton } = ns.getAdState(this.doc);
      const point = state === "ad-skippable" ? getClickPoint(skipButton) : null;
      if (!point || !isTopmostAt(skipButton, point)) {
        await this.bridge.send({ type: "debugger-detach" });
        return false;
      }
      const click = await this.bridge.send({ type: "debugger-click", x: point.x, y: point.y });
      if (!click || !click.ok) {
        console.warn("[YouTube Ad Skip] clic refusé :", click && click.error);
        return false;
      }
      return true;
    }

    /** Compte la publicité comme ignorée seulement si le bouton a disparu ou si la publicité est finie. */
    async verifySkipped(button) {
      await wait(this.verifyDelay);
      const after = ns.getAdState(this.doc);
      const stillThere = after.state === "ad-skippable" && after.skipButton === button;
      if (stillThere) return;
      this.reset();
      this.onSkipped();
    }
  }

  Object.assign(ns, {
    AdSkipper,
    getClickPoint,
    isTopmostAt,
    MAX_ATTEMPTS_PER_AD,
    RETRY_DELAY_MS,
    VERIFY_DELAY_MS,
  });
})(YtAdSkip);

if (typeof module !== "undefined" && module.exports) module.exports = YtAdSkip;
