# YouTube Ad Skip

Extension Chrome (Manifest V3) qui clique automatiquement sur le bouton « Ignorer » des publicités YouTube.

> État : **étape 1 — squelette**. L'extension se charge, mais n'agit pas encore sur les publicités.

## Charger l'extension en mode développeur

1. Ouvrir `chrome://extensions` dans Chrome.
2. Activer le **Mode développeur** (en haut à droite).
3. Cliquer sur **Charger l'extension non empaquetée** et sélectionner le dossier du projet (celui qui contient `manifest.json`).
4. Épingler l'extension via l'icône puzzle de la barre d'outils.

Après une modification du code : cliquer sur le bouton de rechargement de l'extension dans `chrome://extensions`, puis **recharger les onglets YouTube ouverts** (les content scripts ne sont injectés qu'au chargement de la page).

## Périmètre

- Site couvert : `https://www.youtube.com/*` uniquement.
- Permissions : aucune pour l'instant.

## Outils

- `py tools/generate_icons.py` : régénère les icônes de `assets/icons/`.

Le cahier des charges est dans [docs/cahier-des-charges.md](docs/cahier-des-charges.md).
