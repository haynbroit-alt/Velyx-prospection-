# VELYX — agent économique autonome, prospection par la preuve

VELYX lit chaque jour la **demande réelle publiée**, construit **avant de répondre** la preuve qu'il sait y répondre
(un échantillon tiré du registre officiel des entreprises), et prépare l'offre jusqu'au dernier geste. Le
propriétaire valide, envoie, encaisse. Le seul compteur d'argent est l'encaissement, avec sa preuve.

Mandat permanent : **0 € avant le premier encaissement** (`politique.json`). Aucun message, prix, publication,
inscription ni dépense sans la validation du propriétaire. Aucune donnée nominative dans ce dépôt public.

## La boucle (une étape = une fonction testée, sur données réelles)

| Étape | Ce que fait VELYX | Module |
|---|---|---|
| OBSERVER | lit codeur.com (liste, RSS, détail) et le registre SIRENE/RNE, sous budget | `src/sources/` |
| COMPRENDRE | faits datés, croyances du modèle du monde | `src/monde.js` |
| CONFRONTER / HYPOTHÈSES | contradiction écrite ; l'instrument est suspecté avant le monde | `src/monde.js` |
| ANTICIPER | vitesse d'offres entre relevés, prévisions notées à l'échéance | `src/strategie.js` |
| PRIORISER / DÉCIDER (CEO) | ordre sur des faits, aucun euro inventé | `src/strategie.js` |
| DÉCIDER (Risk Agent) | politique fermée : autorisé, revue humaine ou interdit | `src/risque.js` |
| SIMULER | exécution à blanc et contrôles (oppositions, holdings, filiales, comptes périmés…) | `src/controles.js` |
| EXÉCUTER / REVUE HUMAINE | listes et brouillons en privé ; tout geste sortant en file de revue | `src/cycle.js` |
| MESURER / APPRENDRE / RÉVISER | KPI réels (« inconnu » sous le seuil), leçons, seul un pari gagné élève une croyance | `src/bilan.js`, `src/monde.js` |
| DREAMING | audit hebdomadaire : registre, antifuite, rejeu des contrôles, « moteur sans client » | `src/bilan.js` |

Socle : registre en ajout seul chaîné SHA-256 et antifuite (`src/registre.js`, `src/garde.js`), porte réseau
unique à liste blanche et budget (`src/socle.js`), recettes déclaratives sans code (`etat/recettes/*.json`).

```bash
npm test && node bin/velyx.js verifier            # 230 tests ; registre + antifuite
NODE_USE_ENV_PROXY=1 node bin/velyx.js cycle      # cycle du jour (idempotent)
node bin/velyx.js revue                           # gestes attendus du propriétaire
node bin/velyx.js etat                            # argent encaissé, paris, gestes
node bin/velyx                                    # toutes les commandes
```

Node ≥ 20, aucune dépendance. Le cycle quotidien suit `.claude/skills/velyx-cycle/SKILL.md`.

## L'offre en cours (fondée sur `reports/Marché fichiers prospection à signaux.md`)

Fichier des **entreprises du BTP immatriculées récemment** sur un département (`btp-creations-zone`), vendu au
forfait aux **courtiers en assurance construction** (`courtiers-construction`) : la décennale est obligatoire à
l'ouverture de tout chantier (C. assurances, art. L241-1), ces courtiers paient déjà 9 à 110 € un lead, aucun vendeur
ne propose ce croisement. Conformité : oppositions à la prospection exclues, diffusion partielle exclue, source et
date citées, aucun nom de dirigeant dans les échantillons. Prix : repères cités, fixés par le propriétaire.

## Mesuré, pas simulé
- 15–16/11/2026, codeur.com : le développement est saturé (100–190 offres par projet) ; la prospection reçoit
  5 offres médianes. Y répondre coûte 31,90 € HT/30 j : codeur.com sert à **lire** la demande, pas à y répondre.
- Contrôles : 246 des 1 111 sociétés IT lues et 9 des 10 de l'échantillon BTP v1 étaient **opposées à la
  prospection** : les brouillons v1 ont été retirés avant tout envoi, l'exclusion est devenue un contrôle bloquant.
- **Argent encaissé : 0 €. Dépensé : 0 €.**

## Gestes du propriétaire
1. Statut pour facturer (micro-entreprise, gratuit) : `docs/statut-micro-entreprise.md`.
2. Nom commercial : NOVARYS est déjà porté par d'autres entreprises ; à confirmer (base des marques INPI).
3. Ouvrir un canal gratuit (e-mail direct, ComeUp ou Malt), relire la revue, fixer le prix, envoyer.

## Reporté (assumé)
Mémoire privée persistante entre conteneurs (Drive), gestes par commentaires GitHub, crochet de session, registre
belge (BCE), preuve d'identité du propriétaire en terminal partagé.
