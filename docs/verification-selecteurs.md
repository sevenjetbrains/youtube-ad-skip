# Vérification des sélecteurs YouTube

**Date :** 14 octobre 2026
**Source :** script du lecteur `https://www.youtube.com/s/player/22cb88bc/player_es6.vflset/fr_FR/base.js`, référencé par une page `/watch` récupérée le même jour.

YouTube modifie régulièrement son lecteur. Refaire cette vérification quand la détection cesse de fonctionner. La méthode est indiquée en bas de page.

## Éléments confirmés

| Élément | Preuve dans `base.js` | Utilisation dans l'extension |
|---|---|---|
| `#movie_player` | `gL(document,"movie_player")` puis lecture de `className` | Lecteur principal |
| Classe `ad-showing` | Ajoutée au début de chaque publicité (`jw(…,"ad-showing")`) et retirée à la fin (`ZT(…)`) | Signal principal de l'état publicitaire |
| Classe `ad-interrupting` | Ajoutée en même temps que `ad-showing` pour les publicités qui interrompent la vidéo | Non utilisée (`ad-showing` suffit) |
| `div.video-ads.ytp-ad-module` | `{K:"div",d8:["video-ads","ytp-ad-module"]}` | Conteneur des publicités |
| `button.ytp-skip-ad-button` | `{K:"button",U:"ytp-skip-ad-button",B:[{…"ytp-skip-ad-button__text"}]}` | Bouton « Ignorer » actuel |
| `button.ytp-ad-skip-button-modern` / `button.ytp-ad-skip-button` | `{K:"button",d8:[this.C?"ytp-ad-skip-button-modern":"ytp-ad-skip-button","ytp-button",…]}` | Anciennes variantes, encore présentes dans le code |

Le libellé du bouton vient du serveur (`A.label`) et dépend de la langue. L'extension ne s'appuie donc pas sur le texte « Ignorer ».

## Limitation majeure : les clics simulés sont rejetés

Les deux implémentations du bouton « Ignorer » commencent leur gestionnaire de clic par ce test :

```js
V0T = function (r, A) { var W = 1; r.isTrusted === !1 && (W = 0); /* … télémétrie … */ return W };
// dans onClick :
V0T(r, …) === 0 ? g.rF(this.api, "onAbnormalityDetected") : (super.onClick(r), g.rF(this.api, "onAdSkip"), …)
```

Un clic déclenché par script (`element.click()` ou `dispatchEvent`) a `isTrusted === false`. Ce clic **ne passe pas la publicité**. Le lecteur déclenche à la place l'événement `onAbnormalityDetected`. Un content script ne peut pas produire d'événement `isTrusted === true`.

Le lecteur journalise aussi la provenance des déplacements dans la vidéo (seek) pendant une publicité (`BISCOTTI_BASED_DETECTION_STATE_AS_SEEK_EVENT_NOT_TRUSTED`). Les avances programmées sont donc détectables par YouTube.

## Vidéo et vitesse de lecture (fonction expérimentale)

**Date :** 15 octobre 2026. **Source :** `base.js` version `21090930`.

| Élément | Preuve dans `base.js` | Utilisation dans l'extension |
|---|---|---|
| `video.html5-main-video` | `g.ZN(W,"video-stream");g.ZN(W,g.V4.MAIN_VIDEO)` avec `MAIN_VIDEO:"html5-main-video"` | Vidéo accélérée pendant une publicité |

- L'événement `ratechange` sert seulement à la lecture (`this.loader.setPlaybackRate(…)`). Il ne déclenche pas `onAbnormalityDetected`, contrairement aux clics simulés.
- Pour certaines publicités, le lecteur remet lui-même la vitesse à 1 (`isLifaAdPlaying()?(…this.api.setPlaybackRate(1))`). L'extension réapplique donc la vitesse à chaque vérification.
- **Limite :** à chaque événement de la vidéo, le lecteur établit un rapport d'état qui contient notamment `playbackRate` (`[136]:K.playbackRate`) et `muted` (`[120]:K.muted`). YouTube peut donc voir l'accélération. La fonction reste expérimentale et désactivée par défaut.

## Blocage et masquage (réglages « blockAds » et « hideAds »)

**Date :** 18 octobre 2026. **Sources :** page `/watch?v=dQw4w9WgXcQ`, lecteur `base.js` version `0229cd64`, application `ytmainappweb` (`kevlar_base`), listes uBlock Origin (`filters.txt`, `quick-fixes.txt`) et EasyList du même jour.

### Données du lecteur (`content/ad-blocker.js`)

| Élément | Preuve | Utilisation dans l'extension |
|---|---|---|
| `var ytInitialPlayerResponse = {…}` | Script en ligne de la page `/watch` (`<script nonce=…>var ytInitialPlayerResponse = {"responseContext":…`) | Variable interceptée par un accesseur posé avant les scripts de la page |
| `adPlacements` au premier niveau | `"adPlacements":[{"adPlacementRenderer":{"config":{"adPlacementConfig":{"kind":"AD_PLACEMENT_KIND_START",…` dans `ytInitialPlayerResponse` | Champ supprimé |
| `adSlots`, `playerAds` | Règles uBlock `json-prune-fetch-response, adPlacements adSlots playerResponse.adPlacements …` et `set, ytInitialPlayerResponse.playerAds, undefined` | Champs supprimés |
| `/youtubei/v1/player` | Table des adresses de l'application : `"/youtubei/v1/player":A` | Réponses `fetch` et `XMLHttpRequest` nettoyées |
| `/youtubei/v1/get_watch` | `"/youtubei/v1/get_watch":new Xu4(…)` ; règle uBlock `[].playerResponse.adPlacements` (tableau de réponses) | Réponses nettoyées, y compris dans chaque `playerResponse` du tableau |
| `adBreakHeartbeatParams` | Présent à côté de `adPlacements` | Conservé, comme le fait uBlock (`"adPlacements.*?("adSlots"\|"adBreakHeartbeatParams")` → `$1`) |
| Contournement par cadre vide | Règle uBlock `trusted-prevent-dom-bypass, Node.prototype.appendChild, fetch` | Tout `<iframe>` about:blank inséré reçoit les mêmes interceptions |

Vérification sur données réelles : le script en ligne de la page `/watch` exécuté dans jsdom après `install()` donne un `ytInitialPlayerResponse` sans `adPlacements`, avec `videoDetails` intact. La réponse de `/youtubei/v1/player` n'a pas pu être obtenue hors navigateur (`playabilityStatus: UNPLAYABLE`, contrôle anti-robot) ; son format est celui que ciblent les règles uBlock ci-dessus.

Non repris de uBlock : les règles qui modifient les requêtes envoyées (`trusted-edit-inbound-object … attestationRequest`) et l'accélération des minuteurs (`nano-stb`). Elles servent à déjouer la détection du blocage et changent souvent ; le clic automatique sert de repli.

### Éléments masqués (`content/ad-hider.css`)

Tous trouvés dans le code de l'application `ytmainappweb` (nombre d'occurrences) : `#masthead-ad` (114), `ytd-video-masthead-ad-v3-renderer` (20), `ytd-ad-slot-renderer` (12), `ytd-in-feed-ad-layout-renderer` (7), `ytd-search-pyv-renderer` (7), `ytd-promoted-video-renderer` (28), `ytd-promoted-sparkles-web-renderer` (25), `#player-ads` (10), `ytd-player-legacy-desktop-watch-ads-renderer` (9), `ytd-companion-slot-renderer` (6), `ytd-action-companion-ad-renderer` (19), `ytd-display-ad-renderer` (36), `ytd-merch-shelf-renderer` (35), `ytd-ads-engagement-panel-content-renderer` (5), `targetId:"engagement-panel-ads"` (8). La règle `ytd-rich-item-renderer:has(> #content > ytd-ad-slot-renderer)` vient d'EasyList.

Écartés volontairement : `ytd-statement-banner-renderer`, `ytd-banner-promo-renderer`, `ytd-brand-video-singleton-renderer` (noms ambigus, peuvent désigner des annonces de YouTube et non des publicités), et tout élément du lecteur (`.video-ads`, `.ytp-ad-module`), nécessaire au clic automatique.

## Méthode de vérification

```sh
curl -sL -A "Mozilla/5.0 …Chrome/141…" "https://www.youtube.com/watch?v=dQw4w9WgXcQ" -o watch.html
grep -oE '/s/player/[^"]+/base\.js' watch.html | head -1      # URL du lecteur
curl -sL "https://www.youtube.com<URL>" -o base.js
grep -oE '"ytp-[a-z-]*skip[a-z-]*' base.js | sort | uniq -c
grep -oE '.{200}isTrusted.{200}' base.js
# Blocage : champs publicitaires dans la page et adresses de l'application
grep -o 'var ytInitialPlayerResponse = ' watch.html
grep -oE '"(adPlacements|adSlots|playerAds)"' watch.html | sort | uniq -c
APP=$(grep -oE 'https://www\.youtube\.com/s/_/ytmainappweb/_/js/[^"\ ]+' watch.html | head -1)
curl -sL "$APP" -o app.js
grep -oE '"/youtubei/v1/(player|get_watch)"' app.js | sort | uniq -c
grep -oc 'ytd-ad-slot-renderer' app.js      # même chose pour chaque élément de ad-hider.css
```
