// Détection de l'état publicitaire du lecteur YouTube.
// Les content scripts ne sont pas des modules ES : les fichiers de content/
// partagent l'espace de noms YtAdSkip et sont chargés dans l'ordre du manifest.
var YtAdSkip = globalThis.YtAdSkip || (globalThis.YtAdSkip = {});

// Implémentation : étape 2.
