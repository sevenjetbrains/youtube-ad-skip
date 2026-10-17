// =============================================================================
// content/ad-blocker.js — blocage des publicités AVANT leur affichage (comme Brave)
// =============================================================================
//
// Rôle : retirer la description des publicités des données que YouTube envoie au lecteur.
// Sans cette description, le lecteur ne programme aucune publicité : la vidéo démarre
// directement. C'est la technique des « scriptlets » de Brave Shields et de uBlock Origin
// (json-prune, set-constant, trusted-replace-fetch-response…), réécrite ici sans moteur
// de filtres.
//
// Où se trouvent les publicités (vérifié le 18 octobre 2026, voir
// docs/verification-selecteurs.md) :
//   - au premier chargement : variable globale ytInitialPlayerResponse, écrite par un
//     script de la page (« var ytInitialPlayerResponse = {…} ») ;
//   - lors de la navigation interne : réponses JSON de /youtubei/v1/player et
//     /youtubei/v1/get_watch (tableau dont chaque élément peut contenir un playerResponse) ;
//   - champs concernés : adPlacements, adSlots, playerAds.
//
// Exécution particulière :
//   - « monde MAIN » : ce script tourne dans la page elle-même (et non dans l'environnement
//     isolé des autres content scripts), car il doit remplacer fetch, XMLHttpRequest et la
//     variable ytInitialPlayerResponse que le code de YouTube utilise ;
//   - « document_start » : avant tout script de YouTube, sinon les données seraient déjà lues ;
//   - enregistré par background.js (chrome.scripting) seulement si le réglage « blockAds »
//     est activé : dans le monde MAIN, chrome.storage n'est pas accessible.
//
// Discrétion : le code de YouTube partage cet environnement. Ce fichier ne crée donc aucune
// variable globale, et les fonctions remplacées sont des Proxy de l'original (leur
// toString() affiche toujours « [native code] »).
//
// Limite : les publicités insérées par le serveur directement dans le flux vidéo (SSAI) ne
// figurent pas dans ces données. Le clic automatique (ad-skipper.js) reste alors le repli.
// =============================================================================

(function () {
  "use strict";

  // Références natives capturées au démarrage (avant tout script de la page).
  const jsonParse = JSON.parse;
  const jsonStringify = JSON.stringify;
  const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

  /** Champs qui décrivent les publicités dans une réponse du lecteur. */
  const AD_KEYS = ["adPlacements", "adSlots", "playerAds"];

  /** Test rapide : le texte contient-il au moins une clé publicitaire ? */
  const AD_KEY_TEST = /"(?:adPlacements|adSlots|playerAds)"/;

  /**
   * Repli pour un texte qui n'est pas du JSON valide (réponse découpée, préfixe anti-XSSI…) :
   * la clé est renommée, comme le fait la règle uBlock « trusted-rpfr '"adSlots"' '"no_ads"' ».
   * Le lecteur ne trouve plus le champ et l'ignore.
   */
  const AD_KEY_RENAME = /"(?:adPlacements|adSlots|playerAds)"(?=\s*:)/g;

  /**
   * Adresses dont la réponse décrit la vidéo à lire (et ses publicités).
   * « player » suivi de « / » (ex. /player/ad_break) n'est volontairement pas concerné.
   */
  const AD_ENDPOINT = /\/youtubei\/v1\/(?:player|get_watch)(?:[?#]|$)/;

  // --- Fonctions de nettoyage (indépendantes du navigateur, testées dans Node) ----

  /**
   * Supprime les champs publicitaires d'une réponse du lecteur, en place.
   * Accepte une réponse /player, une réponse contenant « playerResponse », ou un tableau de
   * telles réponses (/get_watch).
   * @param {unknown} data
   * @returns {boolean} vrai si au moins un champ a été supprimé
   */
  function pruneAds(data) {
    if (!data || typeof data !== "object") return false;
    if (Array.isArray(data)) {
      let changed = false;
      for (const item of data) changed = pruneAds(item) || changed;
      return changed;
    }
    let changed = false;
    for (const key of AD_KEYS) {
      if (hasOwn(data, key)) {
        delete data[key];
        changed = true;
      }
    }
    if (hasOwn(data, "playerResponse")) changed = pruneAds(data.playerResponse) || changed;
    return changed;
  }

  /**
   * Version texte de pruneAds, pour les réponses réseau.
   * @param {unknown} text corps de la réponse
   * @returns {string | null} texte nettoyé, ou null s'il n'y avait rien à retirer
   */
  function pruneAdsInText(text) {
    if (typeof text !== "string" || !AD_KEY_TEST.test(text)) return null;
    let data;
    try {
      data = jsonParse(text);
    } catch {
      return text.replace(AD_KEY_RENAME, '"no_ads"');
    }
    return pruneAds(data) ? jsonStringify(data) : null;
  }

  /**
   * Vrai si la requête vise une adresse qui décrit les publicités.
   * @param {unknown} input premier argument de fetch (texte, URL ou Request) ou URL de XHR
   */
  function isAdEndpoint(input) {
    let url = "";
    if (typeof input === "string") url = input;
    else if (input && typeof input.url === "string") url = input.url; // Request
    else if (input) url = String(input); // URL
    return AD_ENDPOINT.test(url);
  }

  // --- Points d'interception dans la page ----------------------------------------

  /**
   * Intercepte la variable globale ytInitialPlayerResponse.
   *
   * On définit à l'avance une propriété avec accesseur sur window. Quand le script de la
   * page exécute « var ytInitialPlayerResponse = {…} », la déclaration var réutilise cette
   * propriété existante et l'affectation passe par notre setter, qui retire les publicités
   * avant que le lecteur ne lise l'objet.
   * @param {Window} win
   */
  function hookInitialPlayerResponse(win) {
    let value = win.ytInitialPlayerResponse;
    pruneAds(value);
    try {
      Object.defineProperty(win, "ytInitialPlayerResponse", {
        configurable: true,
        enumerable: true,
        get() {
          return value;
        },
        set(next) {
          pruneAds(next);
          value = next;
        },
      });
    } catch {
      // Propriété déjà verrouillée : on laisse faire (les réponses réseau restent filtrées).
    }
  }

  /**
   * Renvoie une copie de la réponse sans publicités, ou la réponse d'origine si elle n'en
   * contient pas ou si son corps est illisible.
   * @param {Window} win
   * @param {Response} response
   */
  async function rewriteResponse(win, response) {
    try {
      const pruned = pruneAdsInText(await response.clone().text());
      if (pruned === null) return response;
      const headers = new win.Headers(response.headers);
      headers.delete("content-length"); // la taille a changé
      const copy = new win.Response(pruned, { status: response.status, statusText: response.statusText, headers });
      // Propriétés qu'un Response construit à la main n'a pas : on recopie celles d'origine.
      for (const prop of ["ok", "redirected", "type", "url"]) {
        Object.defineProperty(copy, prop, { value: response[prop] });
      }
      return copy;
    } catch {
      return response;
    }
  }

  /**
   * Remplace fetch par un Proxy qui nettoie les réponses /player et /get_watch.
   * Les autres requêtes passent sans aucune modification.
   * @param {Window} win
   */
  function hookFetch(win) {
    const nativeFetch = win.fetch;
    if (typeof nativeFetch !== "function") return;
    win.fetch = new Proxy(nativeFetch, {
      apply(target, thisArg, args) {
        const promise = Reflect.apply(target, thisArg, args);
        if (!isAdEndpoint(args[0])) return promise;
        return promise.then((response) => rewriteResponse(win, response));
      },
    });
  }

  /**
   * Nettoie les réponses XMLHttpRequest des mêmes adresses.
   * open() est intercepté pour mémoriser l'adresse ; les lectures de responseText et
   * response renvoient ensuite la version nettoyée, une fois la réponse complète.
   * @param {Window} win
   */
  function hookXhr(win) {
    const XHR = win.XMLHttpRequest;
    if (typeof XHR !== "function") return;
    const proto = XHR.prototype;
    const urls = new WeakMap(); // requête → adresse demandée
    const cache = new WeakMap(); // requête → { raw, value } : le nettoyage n'est fait qu'une fois

    proto.open = new Proxy(proto.open, {
      apply(target, xhr, args) {
        urls.set(xhr, String(args[1]));
        cache.delete(xhr);
        return Reflect.apply(target, xhr, args);
      },
    });

    for (const prop of ["responseText", "response"]) {
      const desc = Object.getOwnPropertyDescriptor(proto, prop);
      if (!desc || typeof desc.get !== "function") continue;
      const get = new Proxy(desc.get, {
        apply(target, xhr, args) {
          const raw = Reflect.apply(target, xhr, args);
          // Réponse incomplète ou adresse sans rapport : aucune modification.
          if (xhr.readyState !== 4 || !isAdEndpoint(urls.get(xhr))) return raw;
          if (typeof raw !== "string") {
            if (xhr.responseType === "json") pruneAds(raw); // objet déjà décodé : nettoyé en place
            return raw;
          }
          const cached = cache.get(xhr);
          if (cached && cached.raw === raw) return cached.value;
          const value = pruneAdsInText(raw) ?? raw;
          cache.set(xhr, { raw, value });
          return value;
        },
      });
      Object.defineProperty(proto, prop, { ...desc, get });
    }
  }

  /** Fenêtres déjà équipées (la page et ses cadres vides). */
  const hookedWindows = new WeakSet();

  /**
   * Installe fetch et XHR nettoyés dans une fenêtre (une seule fois par fenêtre).
   * @param {Window} win
   */
  function hookNetwork(win) {
    if (hookedWindows.has(win)) return;
    hookedWindows.add(win);
    hookFetch(win);
    hookXhr(win);
  }

  /**
   * Empêche le contournement par cadre vide.
   *
   * Pour retrouver un fetch d'origine, une page peut créer un <iframe> vide (about:blank) et
   * utiliser son contentWindow.fetch, qui n'est pas intercepté. uBlock Origin contre cette
   * technique sur YouTube (règle « trusted-prevent-dom-bypass, Node.prototype.appendChild,
   * fetch ») ; on fait de même : tout cadre vide inséré reçoit aussitôt les mêmes
   * interceptions.
   * @param {Window} win
   */
  function hookFrameBypass(win) {
    const proto = win.Node && win.Node.prototype;
    if (!proto) return;
    const equipFrames = (args) => {
      for (const node of args) {
        if (!node || node.nodeName !== "IFRAME") continue;
        try {
          const frameWin = node.contentWindow;
          if (frameWin && frameWin.location.href === "about:blank") hookNetwork(frameWin);
        } catch {
          // Cadre d'une autre origine : inaccessible, et sans intérêt pour ce contournement.
        }
      }
    };
    for (const method of ["appendChild", "insertBefore"]) {
      if (typeof proto[method] !== "function") continue;
      proto[method] = new Proxy(proto[method], {
        apply(target, thisArg, args) {
          const result = Reflect.apply(target, thisArg, args);
          equipFrames(args);
          return result;
        },
      });
    }
  }

  /**
   * Point d'entrée : installe toutes les interceptions dans la fenêtre donnée.
   * @param {Window} win
   */
  function install(win) {
    hookInitialPlayerResponse(win);
    hookNetwork(win);
    hookFrameBypass(win);
  }

  // Dans Chrome, « module » n'existe pas : le blocage démarre aussitôt. Dans les tests Node,
  // on exporte les fonctions sans rien installer.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { AD_KEYS, pruneAds, pruneAdsInText, isAdEndpoint, install, hookNetwork };
  } else {
    install(window);
  }
})();
