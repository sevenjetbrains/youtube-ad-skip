# YouTube Ad Skip

Extension Chrome (Manifest V3) qui clique automatiquement sur le bouton « Ignorer » des publicités YouTube.

> État : **étape 3 — clic automatique**. La popup, les statistiques et les réglages arrivent aux étapes 4 et 5.

## Fonctionnement

1. `content/observer.js` surveille la classe `ad-showing` du lecteur `#movie_player`, puis, pendant une publicité seulement, le conteneur `.video-ads`.
2. `content/detector.js` vérifie que le bouton « Ignorer » est un vrai bouton de publicité, situé dans le lecteur, visible et activé.
3. `content/ad-skipper.js` demande au service worker un **vrai clic** au centre du bouton, puis vérifie après 1,5 s que la publicité a bien été quittée. Il fait au plus 3 tentatives par publicité, espacées d'au moins 1 s.
4. `background.js` s'attache à l'onglet avec `chrome.debugger`, envoie l'appui et le relâchement de la souris, puis se détache aussitôt.

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

Les tests utilisent `node --test` et jsdom. Ils reproduisent la structure du lecteur relevée dans le code de YouTube et utilisent une fausse API `chrome`.

## Périmètre

- Site couvert : `https://www.youtube.com/*` uniquement.
- Permissions : `debugger`.

## Outils

- `py tools/generate_icons.py` : régénère les icônes de `assets/icons/`.

Le cahier des charges est dans [docs/cahier-des-charges.md](docs/cahier-des-charges.md).
