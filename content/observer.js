// Point d'entrée du content script : surveillance du lecteur (MutationObserver)
// et de la navigation interne de YouTube.
var YtAdSkip = globalThis.YtAdSkip || (globalThis.YtAdSkip = {});

// Trace de chargement, visible dans la console de l'onglet YouTube (niveau « Verbose »).
console.debug("[YouTube Ad Skip] content script chargé sur", location.href);

// Implémentation : étape 3.
