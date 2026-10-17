# Procédure de test manuel

À dérouler dans Chrome après chaque modification importante, ou quand YouTube change son interface. Les scénarios 1 à 10 sont ceux du cahier des charges (section 6). Les tests automatisés couvrent la même liste (voir le README), mais seul un essai dans Chrome confirme le comportement face au vrai lecteur YouTube.

## Préparation

1. `chrome://extensions` → recharger l'extension.
2. **Recharger tous les onglets YouTube** : un onglet ouvert avant le rechargement garde l'ancien script, qui s'arrête de lui-même (la fenêtre affiche alors « Inactif sur cet onglet »).
3. Ouvrir la console de l'onglet YouTube (F12 → Console) et filtrer sur `YouTube Ad Skip`. Chaque publicité réellement ignorée y écrit « publicité ignorée ».
4. Pour obtenir des publicités : enchaîner plusieurs vidéos populaires, ou recharger une vidéo. Une session YouTube Premium n'en affiche pas.
5. Pour tester le **clic automatique** (scénarios 2 à 5), désactiver d'abord « Bloquer les publicités avant leur affichage » et recharger l'onglet : sinon les publicités n'apparaissent plus.

## Scénarios du cahier des charges

| # | Scénario | Actions | Résultat attendu |
|---|---|---|---|
| 1 | Vidéo sans publicité | Lancer une vidéo sans publicité, changer la vitesse (×1,5), mettre en pause, avancer | Aucun message dans la console, pas de bandeau du débogueur, vitesse et commandes inchangées. Fenêtre : « Actif — aucune publicité en cours » |
| 2 | Publicité avec bouton « Ignorer » | Attendre une publicité ignorable | Dès que le bouton apparaît : bandeau « a commencé à déboguer ce navigateur » bref, publicité quittée, « publicité ignorée » dans la console, compteurs +1 |
| 3 | Bouton disponible après quelques secondes | Pendant le compte à rebours, ouvrir la fenêtre | Fenêtre : « bouton « Ignorer » pas encore disponible ». Aucun clic avant l'apparition du bouton, puis clic immédiat |
| 4 | Publicité non ignorable | Attendre une publicité sans bouton (expérimental désactivé) | Publicité lue normalement, aucun clic, compteurs inchangés. Avec l'expérimental activé : lecture accélérée et muette, puis vidéo à vitesse normale avec le son |
| 5 | Publicités successives | Attendre un bloc de deux publicités | Chaque publicité ignorable est ignorée et comptée séparément |
| 6 | Désactivation pendant une lecture | Pendant une publicité, couper l'interrupteur de la fenêtre | Plus aucun clic ni accélération ; vidéo rétablie si elle était accélérée. Fenêtre : « En pause ». Réactiver : la publicité suivante est de nouveau traitée |
| 7 | Navigation sans rechargement | Depuis l'accueil, ouvrir une vidéo, puis une vidéo suggérée, puis une vidéo d'une playlist | Les publicités sont traitées sur chaque vidéo sans recharger la page |
| 8 | Redémarrage du navigateur | Couper le clic automatique dans les paramètres, fermer **toutes** les fenêtres de Chrome, rouvrir | Réglage conservé ; « cette session » revenu à 0 ; « au total » conservé |
| 9 | Interface YouTube modifiée ou absente | Ouvrir l'accueil, une recherche, une page de chaîne, un Short | Aucune erreur dans la console. Fenêtre : « Actif — en attente d'une vidéo » sur les pages sans lecteur |
| 10 | Erreur de détection | Recharger l'extension dans `chrome://extensions` sans recharger l'onglet YouTube, puis attendre une publicité | La page continue de fonctionner normalement. L'ancien script s'arrête (« extension rechargée » dans la console), aucun clic ni accélération ; fenêtre : « Inactif sur cet onglet ». Après rechargement de l'onglet, tout refonctionne |

## Blocage et masquage (comme Brave)

| Vérification | Actions | Résultat attendu |
|---|---|---|
| Blocage au premier chargement | Blocage activé. Ouvrir directement l'adresse d'une vidéo populaire, plusieurs fois | La vidéo démarre sans publicité, sans bandeau du débogueur. Console : `ytInitialPlayerResponse.adPlacements` vaut `undefined` |
| Blocage en navigation interne | Depuis l'accueil, ouvrir une vidéo, puis une vidéo suggérée, puis une vidéo d'une playlist | Aucune publicité. Onglet Réseau, requête `player` ou `get_watch` : la réponse lue par la page ne contient plus `adPlacements` (vérifier dans la console avec un point d'arrêt, l'onglet Réseau montre la réponse brute) |
| Repli sur le clic | Si une publicité passe malgré le blocage | Le bouton « Ignorer » est cliqué comme avant (scénario 2) |
| Masquage | Accueil, recherche d'un produit (ex. « aspirateur »), page d'une vidéo | Aucune vignette « Sponsorisé », pas de grande publicité en haut de l'accueil, pas d'encart publicitaire à droite du lecteur. Les vidéos ordinaires et les bannières d'annonce de YouTube restent visibles |
| Réglages | Désactiver le blocage, recharger l'onglet | Les publicités réapparaissent et sont traitées par le clic automatique. Réactiver, recharger : plus de publicités |
| Avertissement anti-bloqueur | Regarder plusieurs vidéos d'affilée avec le blocage | Pas de fenêtre « les bloqueurs de publicités ne sont pas autorisés ». Si elle apparaît : le noter (date, vidéo) et désactiver le blocage |
| Discrétion | Console de l'onglet : `fetch.toString()` | Affiche `function fetch() { [native code] }` |

## Fenêtre et paramètres

| Vérification | Résultat attendu |
|---|---|
| Ouvrir la fenêtre sur un onglet non YouTube | « Inactif sur cet onglet — ouvrez ou rechargez une page YouTube » |
| « Réinitialiser les statistiques » | Les deux compteurs reviennent à 0 |
| Deux onglets YouTube avec publicités en même temps | « au total » augmente de 2, aucun incrément perdu |
| « Paramètres » | La page d'options s'ouvre dans un onglet |
| Couper « Clic automatique » (expérimental désactivé, blocage activé) | Fenêtre : « Actif — blocage seul, clic automatique désactivé dans les paramètres » ; aucun clic pendant les publicités |
| Couper aussi le blocage et le masquage | Fenêtre : « En pause — toutes les fonctions sont désactivées dans les paramètres » |
| Changer un réglage dans la page d'options pendant que la fenêtre est ouverte | La fenêtre suit le changement |
| « Aide et informations » | La page d'aide s'ouvre |
| Thème sombre de Windows | Fenêtre, options et aide lisibles en sombre |

## Non-régression et ressources

- **Bouton sans rapport** : pendant une publicité, aucun autre bouton (lecture, suivant, plein écran, lien de l'annonceur) n'est actionné.
- **Ressources** : ouvrir le Gestionnaire de tâches de Chrome (Maj+Échap) pendant une vidéo sans publicité. L'extension ne doit pas consommer de processeur de façon notable. Hors publicité, elle n'observe qu'un attribut du lecteur ; elle ne vérifie toutes les 500 ms que pendant une publicité.
- **Confidentialité** : outils de développement → onglet Réseau, filtrer sur `chrome-extension://`. L'extension ne fait aucune requête. `content/ad-blocker.js` intercepte les `fetch` et `XMLHttpRequest` de YouTube pour en retirer les publicités, mais n'en émet aucun et n'envoie rien.

## Résultats du 14 et 15 octobre 2026 (Chrome, Windows 10)

Validés par l'utilisateur : scénario 2 (publicités ignorées et comptées, avec les outils de développement ouverts), affichage de la fenêtre et indicateur d'état, compteurs et réinitialisation, lien d'aide, page d'options, fonction expérimentale (accélération puis retour à la normale).
