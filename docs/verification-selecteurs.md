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

## Méthode de vérification

```sh
curl -sL -A "Mozilla/5.0 …Chrome/141…" "https://www.youtube.com/watch?v=dQw4w9WgXcQ" -o watch.html
grep -oE '/s/player/[^"]+/base\.js' watch.html | head -1      # URL du lecteur
curl -sL "https://www.youtube.com<URL>" -o base.js
grep -oE '"ytp-[a-z-]*skip[a-z-]*' base.js | sort | uniq -c
grep -oE '.{200}isTrusted.{200}' base.js
```
