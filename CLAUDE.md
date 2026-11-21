# Consignes de travail — VELYX

Héritées de l'espace commun GALILÉE, CORTEX, LAVOISIER (`haynbroit-alt/Tr`) : leurs moteurs ont tout démontré en
simulation et rien encaissé. VELYX commence par le marché réel et s'y tient.

## Ordre de chaque session
1. `node bin/velyx.js etat` : argent encaissé, paris ouverts, gestes attendus. Un pari échu sans réponse se clôt
   d'abord (acte `reponse` du propriétaire, puis `lecon`).
2. `node bin/velyx.js marche` au plus une fois par jour : la demande change, la concurrence aussi.
3. Choisir **une** annonce à faible concurrence où une preuve peut se construire sans le client ; écrire la recette,
   construire la liste, la **contrôler à la main** sur dix fiches, puis seulement le brouillon.

## Interdits
- Simuler un marché, un client ou un résultat. Additionner un potentiel (budget affiché, CA d'une cible) à un gain.
- Envoyer, publier, fixer un prix ou s'engager au nom du propriétaire. Dépenser un euro sans son accord explicite.
- Mettre des données nominatives dans git : tout ce qui nomme une personne va dans `prive/`.
- Prolonger une recherche sans pari : au-delà d'une heure sans brouillon prêt, s'arrêter et consigner pourquoi.

## Avant tout commit
`npm test` et `node bin/velyx.js verifier`.

## Mémoire
Glossaire, projets et préférences : `memory/`. Tâches : `TASKS.md` (tableau de bord : `dashboard.html`).
Le dépôt est public : aucune donnée personnelle dans `memory/` ni `TASKS.md`.

## Fiabilité avant sobriété — la preuve prime sur le plafond de sortie
- Toute vérification (`npm test`, `velyx verifier`, `velyx garde`) passe par `.claude/bin/journal <étiquette> <commande>` :
  journal complet sur disque, résumé jamais tronqué, code de sortie exact en première et dernière ligne.
- Jamais `vérification | tail/head/grep` sans `pipefail` : le pipe renvoie le code du filtre et masque l'échec. Le
  crochet `.claude/hooks/garde_pipe.py` refuse ces commandes.
- « Réussi » exige : code 0 ET la ligne de bilan vue (`# fail 0`, `"ok": true`). Sinon écrire « non vérifié » et pourquoi.
- Fusion d'une PR seulement si tous les contrôles de la tête actuelle sont en `success` et les vérifications locales à 0.

## Sobriété — chaque session, sans exception
- Lire ciblé : Grep/Glob d'abord, puis Read avec `offset`/`limit`. Ne jamais relire un fichier déjà lu et inchangé.
- Ne jamais lire en entier `registre/journal.jsonl`, `prive/cache/` ni `package-lock.json`.
- Code minimal : le plus petit diff qui résout le problème.
- Carte : `bin/velyx.js` (commandes), `src/` (`cycle`, `recettes`, `brouillons`, `controles`, `risque`, `registre`, `garde`,
  `monde`, `strategie`, `bilan`, `site`, `sources/`), `etat/` (état public), `registre/journal.jsonl` (actes, ajout seul),
  `prive/` (listes et fiches nominatives, hors git), `test/`, `reports/` (étude de marché).
