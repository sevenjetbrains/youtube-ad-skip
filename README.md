# YouTube Ad Skip

Extension Chrome (Manifest V3) qui clique automatiquement sur le bouton « Ignorer » des publicités YouTube dès qu'il est disponible.

> État : **version 0.1.0, étapes 1 à 6 du cahier des charges terminées.** Usage personnel, en mode développeur (voir [Limites](#limites-connues)).

## Fonctionnalités

### Opérationnelles

- Détection des publicités sur `www.youtube.com`, au premier chargement comme lors de la navigation interne (sans rechargement de la page).
- Clic **réel** sur « Ignorer » dès que le bouton est visible et activé, avec vérification que la publicité a bien été quittée (au plus 3 tentatives par publicité).
- Fenêtre de l'extension : interrupteur général, état de l'onglet actif, publicités ignorées pendant la session et au total, réinitialisation, liens vers les paramètres et l'aide.
- Page de paramètres : activation générale, clic automatique, fonctions expérimentales. Réglages conservés après un redémarrage de Chrome et appliqués immédiatement aux onglets ouverts.
- Arrêt propre de l'ancien script quand l'extension est rechargée ou mise à jour sans recharger l'onglet.

### Expérimentales (désactivées par défaut)

- **Publicités non ignorables** : pendant une publicité seulement, lecture accélérée (×8) et son coupé ; vitesse et son rétablis à la fin. YouTube peut voir ce changement (voir [Limites](#limites-connues)).

### Non prises en charge

- Blocage des publicités avant leur affichage : l'extension agit pendant la publicité, elle ne l'empêche pas.
- Suppression immédiate des publicités non ignorables (seulement accélérées, en expérimental).
- `m.youtube.com`, YouTube Music, vidéos YouTube intégrées dans d'autres sites, Shorts.
- Publicités hors du lecteur (bannières, publicités dans les résultats de recherche ou le fil).

## Installation (mode développeur)

1. Ouvrir `chrome://extensions` dans Chrome.
2. Activer le **Mode développeur** (en haut à droite).
3. Cliquer sur **Charger l'extension non empaquetée** et sélectionner le dossier du projet (celui qui contient `manifest.json`).
4. Accepter la permission **« Accéder au débogueur de page »** (voir [Pourquoi `chrome.debugger`](#pourquoi-chromedebugger-)).
5. Épingler l'extension via l'icône puzzle de la barre d'outils.
6. Recharger les onglets YouTube déjà ouverts.

**Après une modification du code** : cliquer sur le bouton de rechargement de l'extension dans `chrome://extensions`, puis **recharger les onglets YouTube**. Les content scripts ne sont injectés qu'au chargement de la page ; l'ancien script d'un onglet non rechargé s'arrête de lui-même.

## Utilisation

**Fenêtre** (clic sur l'icône) :

- **Ignorer les publicités** : interrupteur général, effet immédiat dans tous les onglets, même pendant une lecture.
- **Indicateur d'état** de l'onglet actif : en pause, inactif (page non YouTube ou onglet à recharger), en attente d'une vidéo, aucune publicité, publicité en cours.
- **Compteurs** de publicités réellement ignorées : *cette session* (remis à 0 à la fermeture de Chrome) et *au total* (conservé).
- **Réinitialiser les statistiques**, **Paramètres**, **Aide et informations**.

**Paramètres** (lien de la fenêtre, ou clic droit sur l'icône → Options) :

| Réglage | Défaut | Effet |
|---|---|---|
| Activer l'extension | activé | Interrupteur général (le même que dans la fenêtre) |
| Clic automatique sur « Ignorer » | activé | Clic réel via `chrome.debugger` |
| Fonctions expérimentales | **désactivé** | Pendant une publicité : lecture ×8 et son coupé, rétablis à la fin |

Si le clic automatique et les fonctions expérimentales sont tous deux désactivés, la surveillance du lecteur s'arrête complètement.

## Architecture

```text
manifest.json              Déclaration MV3 : permissions, content scripts, popup, options
background.js              Service worker : vrais clics (chrome.debugger) et compteurs
common/settings.js         Réglages : valeurs par défaut, lecture, application des changements
content/detector.js        État publicitaire du lecteur et bouton « Ignorer » utilisable
content/ad-skipper.js      Demande du clic, vérification du résultat, limitation des tentatives
content/ad-accelerator.js  Fonction expérimentale : vitesse ×8 et son coupé pendant une publicité
content/observer.js        Surveillance (MutationObserver, navigation) et lien avec les réglages
popup/                     Fenêtre de l'extension (HTML, CSS, JS)
options/                   Page de paramètres
help/                      Page d'aide et d'informations
assets/icons/              Icônes 16, 32, 48 et 128 px
tests/                     Tests automatisés (node --test + jsdom) et faux DOM / fausse API chrome
docs/                      Cahier des charges, vérification des sélecteurs, procédure de test manuel
tools/generate_icons.py    Génération des icônes
```

Écarts avec l'arborescence proposée par le cahier des charges : `common/settings.js` évite de dupliquer les réglages entre content scripts, fenêtre et options ; `help/` est la page d'aide demandée en 2.4 ; `content/ad-accelerator.js` isole la fonction expérimentale.

### Déroulement

1. `observer.js` lit les réglages, puis surveille la classe `ad-showing` du lecteur `#movie_player`. Pendant une publicité seulement, il observe aussi le conteneur `.video-ads` et vérifie toutes les 500 ms (une transition CSS ne produit pas toujours de mutation). Il suit l'événement `yt-navigate-finish` de la navigation interne.
2. `detector.js` vérifie que le bouton « Ignorer » est un vrai `<button>` de publicité, situé dans le lecteur, visible et activé. Il ne s'appuie pas sur le texte du bouton, qui dépend de la langue.
3. `ad-skipper.js` demande au service worker de s'attacher à l'onglet, recalcule la position du bouton (le bandeau du débogueur peut décaler la page), vérifie que rien ne le recouvre, demande le clic, puis vérifie après 1,5 s que la publicité a été quittée. Seules les publicités réellement quittées sont comptées.
4. `background.js` envoie l'appui et le relâchement de la souris (`Input.dispatchMouseEvent`) puis se détache aussitôt (au plus tard après 3 s). Il est le seul à écrire les compteurs, l'un après l'autre, pour qu'aucun incrément ne se perde entre deux onglets. Il vérifie l'expéditeur de chaque message : un clic ne peut être demandé que par le content script du cadre principal d'un onglet `www.youtube.com`, et la réinitialisation que par une page de l'extension.
5. La fenêtre interroge le content script de l'onglet actif (« get-status ») : aucune permission `tabs` n'est nécessaire.

### Stockage

| Clé | Zone | Contenu |
|---|---|---|
| `enabled`, `autoSkip`, `experimental` | `chrome.storage.local` | Réglages (conservés) |
| `totalSkipped` | `chrome.storage.local` | Compteur total (conservé) |
| `sessionSkipped` | `chrome.storage.session` | Compteur de session (effacé à la fermeture de Chrome) |

## Pourquoi `chrome.debugger` ?

Le lecteur YouTube rejette les clics simulés (`event.isTrusted === false`) : un `button.click()` ne fait pas passer la publicité et déclenche `onAbnormalityDetected`. Le détail est dans [docs/verification-selecteurs.md](docs/verification-selecteurs.md). Seul le protocole DevTools, accessible via `chrome.debugger`, permet à une extension de produire un clic réel.

Conséquences :

- À l'installation, Chrome demande la permission d'**accéder au débogueur de page**.
- À chaque clic, Chrome affiche brièvement le bandeau « YouTube Ad Skip a commencé à déboguer ce navigateur ». Pour un usage personnel, il disparaît si Chrome est lancé avec l'option `--silent-debugger-extension-api`.
- Si une autre extension est déjà attachée à l'onglet comme débogueur, le clic échoue ; la publicité n'est alors pas comptée. Les outils de développement de Chrome (F12) ne gênent pas.

## Limites connues

- **Publication** : la permission `debugger` rend une publication sur le Chrome Web Store difficile. L'extension est prévue pour un usage personnel en mode développeur.
- **Publicités non ignorables** : sans la fonction expérimentale, elles sont lues normalement. Avec elle, elles sont accélérées, pas supprimées. Le lecteur relève `playbackRate` et `muted` à chaque événement de la vidéo : YouTube peut voir l'accélération et y réagir.
- **Avances dans la vidéo** : le lecteur journalise les avances programmées pendant une publicité ; l'extension n'en fait donc pas.
- **Évolution de YouTube** : les sélecteurs ont été vérifiés dans le code du lecteur (`base.js` 22cb88bc et 21090930, octobre 2026). Si la détection cesse de fonctionner, refaire la vérification décrite dans [docs/verification-selecteurs.md](docs/verification-selecteurs.md).
- **Onglets ouverts avant une mise à jour** : ils doivent être rechargés.
- **Bandeau du débogueur** : visible à chaque clic, sauf avec l'option de lancement indiquée plus haut.

## Permissions et confidentialité

- Permissions : `debugger` (clic réel) et `storage` (réglages et compteurs). Aucune permission d'hôte ni `tabs`.
- Scripts injectés uniquement sur `https://www.youtube.com/*`, dans le cadre principal.
- Aucun code distant, aucune requête réseau, aucune donnée personnelle collectée ni transmise. Réglages et compteurs restent dans le navigateur.

## Tests

### Automatisés

Prérequis : Node.js 20 ou plus récent.

```sh
npm install
npm test
```

70 tests, avec `node --test` et jsdom. Ils reproduisent la structure du lecteur relevée dans le code de YouTube (`tests/helpers/youtube-dom.js`) et utilisent une fausse API `chrome` (dont `chrome.storage`, dans `tests/helpers/fake-storage.js`).

| Scénario du cahier des charges | Fichiers de test |
|---|---|
| 1. Vidéo sans publicité | `detector`, `observer`, `ad-skipper`, `ad-accelerator` |
| 2. Publicité avec bouton « Ignorer » | `detector`, `ad-skipper`, `background` |
| 3. Bouton disponible après plusieurs secondes | `detector`, `observer` |
| 4. Publicité non ignorable | `detector`, `ad-skipper`, `ad-accelerator` |
| 5. Publicités successives | `detector`, `ad-skipper` |
| 6. Désactivation pendant une lecture | `observer`, `content-script` |
| 7. Navigation sans rechargement | `observer` |
| 8. Paramètres conservés après redémarrage | `content-script`, `settings` |
| 9. Interface YouTube modifiée ou absente | `detector`, `content-script` |
| 10. Erreur de détection | `observer`, `ad-skipper`, `content-script` |
| Aucun clic sur un bouton sans rapport | `detector` (boutons du lecteur, bouton hors lecteur, élément non bouton), `ad-skipper` (bouton recouvert) |

Ces tests ne remplacent pas un essai dans Chrome : jsdom n'a ni mise en page ni vrai lecteur, et le clic réel n'est pas reproductible hors du navigateur.

### Manuels

Procédure complète, scénario par scénario : [docs/procedure-test-manuel.md](docs/procedure-test-manuel.md).

## Outils

- `py tools/generate_icons.py` : régénère les icônes de `assets/icons/`.

Le cahier des charges est dans [docs/cahier-des-charges.md](docs/cahier-des-charges.md).
