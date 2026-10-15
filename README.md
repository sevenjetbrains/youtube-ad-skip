# YouTube Ad Skip

Extension Chrome (Manifest V3) qui clique automatiquement sur le bouton « Ignorer » des publicités YouTube.

> État : **étape 5 — paramètres conservés**. L'étape 6 (tests manuels complets, limites) reste à faire.

## Fonctionnement

1. `content/observer.js` surveille la classe `ad-showing` du lecteur `#movie_player`, puis, pendant une publicité seulement, le conteneur `.video-ads`.
2. `content/detector.js` vérifie que le bouton « Ignorer » est un vrai bouton de publicité, situé dans le lecteur, visible et activé.
3. `content/ad-skipper.js` demande au service worker un **vrai clic** au centre du bouton, puis vérifie après 1,5 s que la publicité a bien été quittée. Il fait au plus 3 tentatives par publicité, espacées d'au moins 1 s.
4. `background.js` s'attache à l'onglet avec `chrome.debugger`, envoie l'appui et le relâchement de la souris, puis se détache aussitôt.

## Fenêtre de l'extension

Un clic sur l'icône ouvre la fenêtre (`popup/`) :

- **interrupteur** « Ignorer les publicités » : arrête ou relance immédiatement la surveillance dans tous les onglets YouTube, même pendant une lecture ;
- **indicateur d'état** de l'onglet actif : en pause, inactif (page non YouTube ou onglet à recharger), en attente d'une vidéo, aucune publicité, publicité en cours ;
- **compteurs** de publicités réellement ignorées : *cette session* (effacé à la fermeture de Chrome, `chrome.storage.session`) et *au total* (conservé, `chrome.storage.local`) ;
- **Réinitialiser les statistiques** : remet les deux compteurs à zéro ;
- **Paramètres** : ouvre la page d'options ;
- **Aide et informations** : ouvre `help/help.html` (fonctionnement, bandeau du débogueur, limites, confidentialité).

Les compteurs sont écrits uniquement par `background.js`, en file d'attente, pour que deux onglets ne perdent pas d'incrément. La popup obtient l'état de l'onglet en interrogeant son content script : aucune permission `tabs` n'est nécessaire.

## Paramètres

Page `options/` (lien « Paramètres » de la fenêtre, ou clic droit sur l'icône > Options) :

| Réglage | Défaut | Effet |
|---|---|---|
| Activer l'extension | activé | Interrupteur général (le même que dans la fenêtre) |
| Clic automatique sur « Ignorer » | activé | Clic réel via `chrome.debugger` |
| Fonctions expérimentales | **désactivé** | Pendant une publicité : lecture ×8 et son coupé, rétablis à la fin |

Les réglages sont définis dans `common/settings.js` et enregistrés dans `chrome.storage.local`, donc conservés après un redémarrage de Chrome. Les onglets YouTube ouverts les appliquent immédiatement (`chrome.storage.onChanged`). Si les deux fonctions sont désactivées, la surveillance du lecteur s'arrête complètement.

### Fonction expérimentale : publicités non ignorables

`content/ad-accelerator.js` agit uniquement quand le lecteur porte la classe `ad-showing`. Il passe la vidéo `video.html5-main-video` à la vitesse ×8 et coupe le son, puis rétablit les valeurs d'origine à la fin de la publicité, sans écraser une vitesse que YouTube aurait déjà rétablie. Une vidéo ordinaire n'est jamais modifiée.

**Limite :** le lecteur relève `playbackRate` et `muted` dans le rapport d'état qu'il établit à chaque événement de la vidéo (voir [docs/verification-selecteurs.md](docs/verification-selecteurs.md)). YouTube peut donc voir l'accélération et y réagir. D'où la désactivation par défaut.

### Pourquoi `chrome.debugger` ?

Le lecteur YouTube rejette les clics simulés (`event.isTrusted === false`) : un `button.click()` ne fait pas passer la publicité et déclenche `onAbnormalityDetected`. Le détail est dans [docs/verification-selecteurs.md](docs/verification-selecteurs.md). Seul le protocole DevTools, accessible via `chrome.debugger`, permet de produire un clic réel.

**Conséquences à connaître :**

- À l'installation, Chrome demande la permission d'**accéder au débogueur de page**.
- À chaque clic, Chrome affiche brièvement le bandeau « YouTube Ad Skip a commencé à déboguer ce navigateur ». Pour usage personnel, il est possible de le masquer en lançant Chrome avec l'option `--silent-debugger-extension-api`.
- Si un autre outil est déjà attaché à l'onglet comme débogueur, le clic échoue. La publicité n'est alors pas comptée.
- Cette permission rend une publication sur le Chrome Web Store difficile.

## Charger l'extension en mode développeur

1. Ouvrir `chrome://extensions` dans Chrome.
2. Activer le **Mode développeur** (en haut à droite).
3. Cliquer sur **Charger l'extension non empaquetée** et sélectionner le dossier du projet (celui qui contient `manifest.json`).
4. Épingler l'extension via l'icône puzzle de la barre d'outils.

Après une modification du code : cliquer sur le bouton de rechargement de l'extension dans `chrome://extensions`, puis **recharger les onglets YouTube ouverts**. Les content scripts ne sont injectés qu'au chargement de la page.

## Tests automatisés

Prérequis : Node.js 20 ou plus récent.

```sh
npm install
npm test
```

Les tests utilisent `node --test` et jsdom. Ils reproduisent la structure du lecteur relevée dans le code de YouTube et utilisent une fausse API `chrome` (dont `chrome.storage`, dans `tests/helpers/fake-storage.js`).

## Périmètre

- Site couvert : `https://www.youtube.com/*` uniquement.
- Permissions : `debugger` (vrai clic) et `storage` (réglage et compteurs, stockés localement).

## Outils

- `py tools/generate_icons.py` : régénère les icônes de `assets/icons/`.

Le cahier des charges est dans [docs/cahier-des-charges.md](docs/cahier-des-charges.md).
