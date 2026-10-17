# YouTube Ad Skip

Extension Chrome (Manifest V3) qui bloque les publicités YouTube avant leur affichage, avec les mêmes techniques que le navigateur Brave, et clique automatiquement sur « Ignorer » pour celles qui passent quand même.

> État : **version 0.2.0.** Étapes 1 à 6 du cahier des charges terminées, puis ajout du blocage et du masquage façon Brave. Usage personnel, en mode développeur (voir [Limites](#limites-connues)).

## Fonctionnalités

### Opérationnelles

- **Blocage avant affichage** (comme Brave Shields / uBlock Origin) : les champs `adPlacements`, `adSlots` et `playerAds` sont retirés des données envoyées au lecteur (`ytInitialPlayerResponse`, réponses de `/youtubei/v1/player` et `/youtubei/v1/get_watch`). Le lecteur ne programme aucune publicité.
- **Masquage des publicités de la page** : accueil, résultats de recherche, encarts à côté de la vidéo (filtres cosmétiques).
- **Repli** pour les publicités qui passent malgré le blocage : détection et clic automatique décrits ci-dessous.
- Détection des publicités sur `www.youtube.com`, au premier chargement comme lors de la navigation interne (sans rechargement de la page).
- Clic **réel** sur « Ignorer » dès que le bouton est visible et activé, avec vérification que la publicité a bien été quittée (au plus 3 tentatives par publicité).
- Fenêtre de l'extension : interrupteur général, état de l'onglet actif, publicités ignorées pendant la session et au total, réinitialisation, liens vers les paramètres et l'aide.
- Page de paramètres : activation générale, blocage, masquage, clic automatique, fonctions expérimentales. Réglages conservés après un redémarrage de Chrome et appliqués immédiatement aux onglets ouverts.
- Arrêt propre de l'ancien script quand l'extension est rechargée ou mise à jour sans recharger l'onglet.

### Expérimentales (désactivées par défaut)

- **Publicités non ignorables** : pendant une publicité seulement, lecture accélérée (×8) et son coupé ; vitesse et son rétablis à la fin. YouTube peut voir ce changement (voir [Limites](#limites-connues)).

### Non prises en charge

- Publicités insérées par YouTube directement dans le flux vidéo, côté serveur (SSAI) : elles ne figurent pas dans les données du lecteur et ne peuvent pas être bloquées. Le clic automatique prend le relais quand elles ont un bouton « Ignorer ».
- Contournement de l'avertissement anti-bloqueur de YouTube (les règles de uBlock prévues pour cela ne sont pas reprises, voir [Limites](#limites-connues)).
- Suppression immédiate des publicités non ignorables qui n'ont pas été bloquées (seulement accélérées, en expérimental).
- `m.youtube.com`, YouTube Music, vidéos YouTube intégrées dans d'autres sites, Shorts.
- Publicités hors du lecteur (bannières, publicités dans les résultats de recherche ou le fil).

## Installation (mode développeur)

1. Ouvrir `chrome://extensions` dans Chrome.
2. Activer le **Mode développeur** (en haut à droite).
3. Cliquer sur **Charger l'extension non empaquetée** et sélectionner le dossier du projet (celui qui contient `manifest.json`).
4. Accepter les permissions **« Accéder au débogueur de page »** (voir [Pourquoi `chrome.debugger`](#pourquoi-chromedebugger-)) et **« Lire et modifier vos données sur www.youtube.com »**.
5. Épingler l'extension via l'icône puzzle de la barre d'outils.
6. Recharger les onglets YouTube déjà ouverts.

**Après une modification du code** : cliquer sur le bouton de rechargement de l'extension dans `chrome://extensions`, puis **recharger les onglets YouTube**. Les content scripts ne sont injectés qu'au chargement de la page ; l'ancien script d'un onglet non rechargé s'arrête de lui-même.

**Mise à jour depuis la 0.1.0** : Chrome peut désactiver l'extension au rechargement, car elle demande de nouvelles permissions (`scripting` et accès à `www.youtube.com`). La réactiver dans `chrome://extensions`.

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
| Bloquer les publicités avant leur affichage | activé | Retire les publicités des données du lecteur. Au prochain chargement de page |
| Masquer les publicités de la page | activé | Cache les publicités hors du lecteur. Au prochain chargement de page |
| Clic automatique sur « Ignorer » | activé | Repli : clic réel via `chrome.debugger` |
| Fonctions expérimentales | **désactivé** | Pendant une publicité : lecture ×8 et son coupé, rétablis à la fin |

Si le clic automatique et les fonctions expérimentales sont tous deux désactivés, la surveillance du lecteur s'arrête complètement ; le blocage et le masquage, eux, restent actifs s'ils sont cochés.

## Architecture

```text
manifest.json              Déclaration MV3 : permissions, content scripts, popup, options
background.js              Service worker : vrais clics (chrome.debugger), compteurs, enregistrement du blocage
common/settings.js         Réglages : valeurs par défaut, lecture, application des changements
content/detector.js        État publicitaire du lecteur et bouton « Ignorer » utilisable
content/ad-skipper.js      Demande du clic, vérification du résultat, limitation des tentatives
content/ad-accelerator.js  Fonction expérimentale : vitesse ×8 et son coupé pendant une publicité
content/observer.js        Surveillance (MutationObserver, navigation) et lien avec les réglages
content/ad-blocker.js      Blocage : retire les publicités des données du lecteur (monde MAIN, document_start)
content/ad-hider.css       Masquage : publicités hors du lecteur
popup/                     Fenêtre de l'extension (HTML, CSS, JS)
options/                   Page de paramètres
help/                      Page d'aide et d'informations
assets/icons/              Icônes 16, 32, 48 et 128 px
tests/                     Tests automatisés (node --test + jsdom) et faux DOM / fausse API chrome
docs/                      Cahier des charges, vérification des sélecteurs, procédure de test manuel
tools/generate_icons.py    Génération des icônes
```

Écarts avec l'arborescence proposée par le cahier des charges : `common/settings.js` évite de dupliquer les réglages entre content scripts, fenêtre et options ; `help/` est la page d'aide demandée en 2.4 ; `content/ad-accelerator.js` isole la fonction expérimentale ; `content/ad-blocker.js` et `content/ad-hider.css` ajoutent le blocage façon Brave.

### Lire le code

Chaque fichier commence par un en-tête qui explique son rôle, et le code est commenté en détail. Ordre de lecture conseillé : `content/ad-blocker.js` → `content/detector.js` → `content/ad-skipper.js` → `background.js` → `content/observer.js` → `common/settings.js` → `content/ad-accelerator.js` → `popup/popup.js` → `options/options.js`.

`manifest.json` ne peut pas contenir de commentaires (format JSON). Ses champs :

| Champ | Rôle |
|---|---|
| `manifest_version: 3` | Format Manifest V3 exigé par le cahier des charges |
| `permissions` | `debugger` (vrai clic), `scripting` (enregistrement du blocage et du masquage) et `storage` (réglages, compteurs) |
| `host_permissions` | `https://www.youtube.com/*` : exigé par `chrome.scripting.registerContentScripts`. Même portée que les content scripts, donc pas d'accès supplémentaire |
| `background.service_worker` | `background.js` |
| `action.default_popup` | Fenêtre ouverte au clic sur l'icône |
| `options_ui` | Page de paramètres, ouverte dans un onglet (`open_in_tab`) |
| `content_scripts` | Scripts injectés sur `https://www.youtube.com/*` uniquement, dans cet ordre : `common/settings.js`, `detector.js`, `ad-skipper.js`, `ad-accelerator.js`, `observer.js` (le dernier démarre l'extension et utilise les précédents) ; `run_at: document_idle` = après le chargement de la page |

### Déroulement

**Blocage (avant toute publicité)**

1. `background.js` lit les réglages à chaque démarrage et à chaque changement, et enregistre auprès de Chrome (`chrome.scripting.registerContentScripts`) `ad-blocker.js` et `ad-hider.css` s'ils sont activés, ou les retire.
2. `ad-blocker.js` s'exécute dans la page elle-même (monde `MAIN`) au tout début du chargement (`document_start`), avant les scripts de YouTube. Il ne peut pas lire `chrome.storage`, d'où l'étape 1.
3. Il pose un accesseur sur `window.ytInitialPlayerResponse` : quand la page exécute `var ytInitialPlayerResponse = {…}`, les champs publicitaires sont retirés avant que le lecteur ne lise l'objet.
4. Il remplace `fetch` et les accesseurs `responseText` / `response` de `XMLHttpRequest` par des `Proxy` qui nettoient les réponses de `/youtubei/v1/player` et `/youtubei/v1/get_watch` (navigation interne). Les autres requêtes ne sont pas touchées. Si le texte n'est pas du JSON valide, les clés sont renommées en `no_ads`, comme le fait uBlock.
5. Il intercepte `appendChild` et `insertBefore` : un `<iframe>` vide inséré par la page (technique pour retrouver un `fetch` non intercepté) reçoit les mêmes interceptions.
6. Il ne crée aucune variable globale, et les fonctions remplacées affichent toujours `[native code]`.

**Repli : clic sur « Ignorer »**

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

Ce n'est utile que pour le repli (publicités qui n'ont pas été bloquées). Le lecteur YouTube rejette les clics simulés (`event.isTrusted === false`) : un `button.click()` ne fait pas passer la publicité et déclenche `onAbnormalityDetected`. Le détail est dans [docs/verification-selecteurs.md](docs/verification-selecteurs.md). Seul le protocole DevTools, accessible via `chrome.debugger`, permet à une extension de produire un clic réel.

Conséquences :

- À l'installation, Chrome demande la permission d'**accéder au débogueur de page**.
- À chaque clic, Chrome affiche brièvement le bandeau « YouTube Ad Skip a commencé à déboguer ce navigateur ». Pour un usage personnel, il disparaît si Chrome est lancé avec l'option `--silent-debugger-extension-api`.
- Si une autre extension est déjà attachée à l'onglet comme débogueur, le clic échoue ; la publicité n'est alors pas comptée. Les outils de développement de Chrome (F12) ne gênent pas.

## Limites connues

- **Course avec YouTube** : YouTube modifie régulièrement le format de ses données et peut détecter le blocage (fenêtre « les bloqueurs de publicités ne sont pas autorisés »). Brave et uBlock Origin corrigent leurs règles plusieurs fois par mois ; cette extension ne reçoit pas de listes de filtres : une correction demande de modifier le code. En cas d'avertissement, désactiver le blocage et recharger la page : le clic automatique reste actif.
- **Publicités insérées côté serveur (SSAI)** : elles font partie du flux vidéo et ne peuvent pas être retirées des données. YouTube les teste depuis 2025–2026 ; le clic automatique est le seul recours.
- **Changement de réglage du blocage** : il s'applique au prochain chargement des pages YouTube, pas aux onglets déjà ouverts.
- **Statistiques** : seules les publicités ignorées par le clic sont comptées ; les publicités bloquées en amont ne le sont pas.
- **Publication** : la permission `debugger` rend une publication sur le Chrome Web Store difficile. L'extension est prévue pour un usage personnel en mode développeur.
- **Publicités non ignorables** : sans la fonction expérimentale, elles sont lues normalement. Avec elle, elles sont accélérées, pas supprimées. Le lecteur relève `playbackRate` et `muted` à chaque événement de la vidéo : YouTube peut voir l'accélération et y réagir.
- **Avances dans la vidéo** : le lecteur journalise les avances programmées pendant une publicité ; l'extension n'en fait donc pas.
- **Évolution de YouTube** : les sélecteurs ont été vérifiés dans le code du lecteur (`base.js` 22cb88bc et 21090930, octobre 2026). Si la détection cesse de fonctionner, refaire la vérification décrite dans [docs/verification-selecteurs.md](docs/verification-selecteurs.md).
- **Onglets ouverts avant une mise à jour** : ils doivent être rechargés.
- **Bandeau du débogueur** : visible à chaque clic, sauf avec l'option de lancement indiquée plus haut.

## Permissions et confidentialité

- Permissions : `debugger` (clic réel), `scripting` (blocage et masquage) et `storage` (réglages et compteurs). Permission d'hôte limitée à `https://www.youtube.com/*`. Pas de `tabs`.
- Scripts injectés uniquement sur `https://www.youtube.com/*`, dans le cadre principal.
- Aucun code distant, aucune requête réseau, aucune donnée personnelle collectée ni transmise. `ad-blocker.js` lit les réponses `/player` et `/get_watch` de YouTube pour en retirer les publicités, dans la page, sans rien en envoyer. Réglages et compteurs restent dans le navigateur.

## Tests

### Automatisés

Prérequis : Node.js 20 ou plus récent.

```sh
npm install
npm test
```

86 tests, avec `node --test` et jsdom. Ils reproduisent la structure du lecteur relevée dans le code de YouTube (`tests/helpers/youtube-dom.js`) et utilisent une fausse API `chrome` (dont `chrome.storage`, dans `tests/helpers/fake-storage.js`).

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
| Blocage avant affichage (variable de la page, `fetch`, `XMLHttpRequest`, cadre vide) et enregistrement selon les réglages | `ad-blocker`, `background` |
| Aucun clic sur un bouton sans rapport | `detector` (boutons du lecteur, bouton hors lecteur, élément non bouton), `ad-skipper` (bouton recouvert) |

Ces tests ne remplacent pas un essai dans Chrome : jsdom n'a ni mise en page ni vrai lecteur, et le clic réel n'est pas reproductible hors du navigateur.

### Manuels

Procédure complète, scénario par scénario : [docs/procedure-test-manuel.md](docs/procedure-test-manuel.md).

## Outils

- `py tools/generate_icons.py` : régénère les icônes de `assets/icons/`.

Le cahier des charges est dans [docs/cahier-des-charges.md](docs/cahier-des-charges.md).
