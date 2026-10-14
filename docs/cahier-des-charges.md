# Cahier des charges — Extension Chrome pour ignorer automatiquement les publicités YouTube

## 1. Présentation du projet

**Nom provisoire :** YouTube Ad Skip

**Type :** Extension pour navigateur Google Chrome.

**Technologie :** Chrome Extensions Manifest V3.

**Langages :** JavaScript, HTML et CSS.

### Objectif

Développer une extension Chrome permettant de détecter automatiquement les publicités diffusées sur YouTube et d'effectuer les actions appropriées pour réduire leur interruption pendant le visionnage.

La priorité est de cliquer automatiquement sur le bouton « Ignorer » dès qu'il devient disponible. L'extension doit également pouvoir détecter les changements d'état du lecteur vidéo et proposer des fonctionnalités complémentaires lorsque cela est techniquement possible.

## 2. Fonctionnalités principales

### 2.1. Détection des publicités

L'extension doit :
- Détecter les éléments de l'interface YouTube indiquant qu'une publicité est en cours de lecture.
- Surveiller l'apparition et la disparition des éléments publicitaires.
- Identifier le bouton permettant d'ignorer une publicité.
- Fonctionner lors du chargement initial d'une vidéo et lors de la navigation entre plusieurs vidéos.
- Éviter les clics répétés inutiles.

La détection devra reposer autant que possible sur les éléments réels de l'interface et sur des mécanismes robustes, plutôt que sur des délais fixes ou des sélecteurs CSS fragiles.

### 2.2. Ignorer automatiquement les publicités

Lorsqu'un bouton permettant d'ignorer une publicité devient disponible, l'extension doit :
1. Vérifier que le bouton correspond bien à l'action d'ignorer la publicité.
2. Vérifier qu'il est visible et activé.
3. Déclencher un clic automatiquement.
4. Vérifier si l'action a permis de quitter la publicité.
5. Continuer la surveillance si une autre publicité apparaît.

L'extension ne doit pas prétendre ignorer immédiatement les publicités non ignorables.

### 2.3. Gestion des publicités non ignorables

Pour les publicités sans bouton d'ignorance :
- Détecter, lorsque cela est fiable, l'état publicitaire du lecteur.
- Étudier la possibilité d'utiliser les commandes de lecture disponibles pour accélérer la lecture, uniquement si cette méthode est techniquement possible et autorisée.
- Ne pas modifier arbitrairement la vitesse de lecture des vidéos ordinaires.
- Revenir au comportement normal à la fin de la publicité.

Le blocage des publicités avant leur affichage est une fonctionnalité distincte et ne doit pas être considéré comme garanti dans la première version.

### 2.4. Interface utilisateur

Créer une fenêtre accessible depuis l'icône de l'extension dans Chrome.

Elle doit comprendre :
- Le nom et le logo de l'extension.
- Un interrupteur pour activer ou désactiver la fonctionnalité.
- Un indicateur de l'état de fonctionnement.
- Le nombre de publicités ignorées pendant la session.
- Un bouton de réinitialisation des statistiques.
- Un lien vers une page d'informations et d'aide.

L'interface doit être simple, moderne, responsive et disponible en français.

### 2.5. Paramètres

Prévoir les paramètres suivants :
- Activation ou désactivation globale.
- Activation ou désactivation du clic automatique sur « Ignorer ».
- Activation ou désactivation des fonctionnalités expérimentales.
- Conservation des préférences entre les redémarrages du navigateur.

Les paramètres seront enregistrés localement à l'aide de l'API `chrome.storage`.

## 3. Architecture technique

Utiliser une architecture modulaire compatible avec Manifest V3.

Arborescence proposée :

```text
youtube-ad-skip/
├── manifest.json
├── background.js
├── content/
│   ├── detector.js
│   ├── ad-skipper.js
│   └── observer.js
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── options/
│   ├── options.html
│   ├── options.css
│   └── options.js
├── assets/
│   └── icons/
├── tests/
└── README.md
```

Responsabilités :

- `manifest.json` : déclaration de l'extension, des permissions et des scripts.
- `background.js` : gestion des événements de l'extension si nécessaire.
- `detector.js` : identification de l'état publicitaire.
- `ad-skipper.js` : gestion du clic automatique sur le bouton d'ignorance.
- `observer.js` : surveillance des changements de l'interface avec `MutationObserver`.
- `popup.js` : gestion de l'interface principale.
- `options.js` : gestion des paramètres.
- `tests/` : tests automatisés des fonctions indépendantes.

L'architecture devra rester simple et éviter les fichiers ou services inutiles.

## 4. Exigences techniques

- Utiliser exclusivement Manifest V3.
- Limiter les permissions Chrome au strict nécessaire.
- Exécuter les scripts uniquement sur les pages YouTube concernées.
- Ne pas utiliser de code distant ni télécharger du code exécutable depuis un serveur.
- Ne pas collecter les données personnelles de l'utilisateur.
- Ne pas transmettre l'historique de navigation à un serveur.
- Éviter les boucles de surveillance gourmandes en ressources.
- Nettoyer les observateurs et les écouteurs lorsqu'ils ne sont plus nécessaires.
- Gérer les erreurs sans interrompre le fonctionnement du navigateur.
- Prévoir les changements dynamiques de l'interface YouTube.
- Utiliser des noms de fonctions et des commentaires compréhensibles.

## 5. Compatibilité et sécurité

L'extension devra fonctionner sur les versions récentes de Google Chrome compatibles avec Manifest V3.

Elle devra :
- Résister autant que possible à la navigation interne de YouTube, sans rechargement complet de la page.
- Ne pas perturber les commandes normales du lecteur vidéo.
- Ne pas modifier les vidéos ordinaires.
- Ne pas injecter de scripts dans des sites autres que ceux prévus.
- Respecter les permissions minimales nécessaires et les règles applicables aux extensions Chrome.

## 6. Tests et validation

Prévoir des tests pour les scénarios suivants :

1. Une vidéo démarre sans publicité.
2. Une publicité avec bouton « Ignorer » apparaît.
3. Le bouton « Ignorer » devient disponible après plusieurs secondes.
4. Une publicité ne peut pas être ignorée.
5. Plusieurs publicités se succèdent.
6. L'utilisateur désactive l'extension pendant une lecture.
7. L'utilisateur navigue vers une autre vidéo sans recharger la page.
8. Le navigateur est redémarré et les paramètres sont conservés.
9. Les éléments de l'interface YouTube changent ou sont absents.
10. Une erreur de détection survient.

Les tests doivent vérifier que l'extension ne clique pas sur des boutons sans rapport avec les publicités et qu'elle ne provoque pas de ralentissement notable.

## 7. Critères d'acceptation

Le projet sera considéré comme fonctionnel lorsque :

- L'extension peut être chargée sans erreur dans Chrome.
- Son activation et sa désactivation fonctionnent.
- Le bouton « Ignorer » est automatiquement actionné lorsqu'il est détecté et activé.
- Les statistiques reflètent les actions réellement effectuées.
- Les paramètres sont conservés après redémarrage.
- Les vidéos ordinaires continuent à fonctionner normalement.
- Aucune donnée personnelle n'est envoyée à un serveur.
- Les limitations concernant les publicités non ignorables sont documentées.

## 8. Livrables attendus

Claude Code devra produire :
- Le code source complet de l'extension.
- Tous les fichiers nécessaires à son fonctionnement.
- Un fichier README contenant les instructions d'installation.
- Une explication de l'architecture et du rôle de chaque fichier.
- Les instructions pour charger l'extension en mode développeur dans Chrome.
- Une procédure de test manuel.
- Des tests automatisés pour les fonctions indépendantes lorsque cela est pertinent.
- Une liste claire des fonctionnalités opérationnelles, expérimentales et non prises en charge.

## 9. Méthode de développement

Procéder par étapes :

**Étape 1 :** créer le squelette de l'extension et vérifier son chargement dans Chrome.

**Étape 2 :** développer la détection des publicités.

**Étape 3 :** implémenter le clic automatique sur le bouton « Ignorer ».

**Étape 4 :** créer la fenêtre de configuration et les statistiques.

**Étape 5 :** ajouter la persistance des paramètres.

**Étape 6 :** réaliser les tests, corriger les erreurs et documenter les limites.

Ne pas développer toutes les fonctionnalités en une seule fois sans validation intermédiaire.

## 10. Instructions finales pour Claude Code

Commence par analyser le cahier des charges et proposer un plan d'implémentation détaillé.

Ensuite, crée les fichiers du projet, implémente les fonctionnalités progressivement et vérifie la cohérence de chaque étape.

N'invente pas de sélecteurs DOM sans les vérifier. Si le fonctionnement de YouTube ne permet pas de garantir une détection fiable, documente cette limitation et propose une solution de repli.

Ne déclare pas une fonctionnalité terminée sans avoir effectué les vérifications possibles. Termine par un récapitulatif des fichiers créés, des tests effectués, des commandes à exécuter et des étapes nécessaires pour installer l'extension dans Chrome.
