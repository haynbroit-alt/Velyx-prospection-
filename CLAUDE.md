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
