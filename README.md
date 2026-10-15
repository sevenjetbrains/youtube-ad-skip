# YouTube Ad Skip

Extension Chrome (Manifest V3) qui clique automatiquement sur le bouton « Ignorer » des publicités YouTube.

> État : **étape 4 — fenêtre et statistiques**. La page d'options (clic automatique, fonctions expérimentales) arrive à l'étape 5.

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
- **Aide et informations** : ouvre `help/help.html` (fonctionnement, bandeau du débogueur, limites, confidentialité).

Les compteurs sont écrits uniquement par `background.js`, en file d'attente, pour que deux onglets ne perdent pas d'incrément. La popup obtient l'état de l'onglet en interrogeant son content script : aucune permission `tabs` n'est nécessaire.

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
