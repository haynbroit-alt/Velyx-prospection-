# VELYX — prospection par la preuve

VELYX part d'une **demande réelle déjà publiée** par un client, construit **avant de répondre** la preuve qu'on sait
y répondre (un échantillon tiré du registre officiel des entreprises), et consigne chaque proposition comme un **pari**
avec un critère d'arrêt. Le seul compteur d'argent est l'encaissement, saisi par le propriétaire avec sa preuve.

```bash
NODE_USE_ENV_PROXY=1 node bin/velyx.js marche              # demande publiée sur codeur.com, concurrence par catégorie
NODE_USE_ENV_PROXY=1 node bin/velyx.js cibler <recette>    # liste à signaux depuis SIRENE/RNE → prive/
node bin/velyx.js brouillon <recette>                      # proposition + pari → prive/
node bin/velyx.js etat                                     # € encaissés, paris ouverts, gestes attendus
npm test && node bin/velyx.js verifier
```

Node ≥ 20, aucune dépendance, 0 € de dépense (deux sources publiques gratuites). `NODE_USE_ENV_PROXY=1` n'est utile que
derrière un proxy. `prive/` est ignoré par git : les listes contiennent des noms de dirigeants et ce dépôt est public.

## Ce qui a été mesuré le 15 novembre 2026 (données réelles, pas de simulation)

**Le marché.** 169 projets publiés sur codeur.com, dont 143 ouverts depuis moins de 14 jours. Médiane : 38 offres par
projet. Les projets de développement sont saturés (sites, SaaS, applications : **100 à 190 offres** chacun). La
**prospection commerciale et le télémarketing** cumulent le plus de demandes (26 en 14 jours) pour une médiane de
**5 offres**. C'est là qu'un nouvel entrant a une chance réelle.

**Ce que ces clients veulent vraiment.** Sur 31 annonces de prospection lues en entier, la plupart achètent des appels,
mais plusieurs achètent d'abord **qui appeler** : « constituer une base de 150 entreprises du BTP » (800 € HT),
« identifier des micro-entreprises IT en Île-de-France », « collecte et enrichissement de fiches entreprises ».

**Deux listes construites pour deux annonces précises** (registre SIRENE/RNE, lecture complète, contrôle manuel) :

| Recette | Annonce | Résultat |
|---|---|---|
| `rachat-it-idf` | rachat de portefeuilles clients IT, Île-de-France (18 offres) | 862 micro-entreprises IT (définition INSEE) dont le dirigeant a 62 ans ou plus ; 378 ont plus de 15 ans ; 178 bénéficiaires sur des comptes de moins de 3 ans |
| `courtier-btp-aura` | courtier en assurance BTP, rendez-vous en Rhône-Alpes (4 offres, 125 € TTC par rendez-vous honoré) | au moins 5 037 PME de 6 à 99 salariés dans les 8 départements (6 250 fiches lues sur 7 424) : 46 immatriculées depuis moins de 3 ans, 1 586 RGE, 182 promoteurs ou constructeurs ; CA et dirigeant déjà connus pour 1 119 |

Le signal de la première, l'âge du dirigeant comme indice de transmission, n'apparaît dans aucune des annonces lues.
Celui de la seconde, l'entreprise récente qui doit justifier d'une décennale à l'ouverture de tout chantier
(C. assurances, art. L241-1), reprend le premier critère du client et le rend filtrable.

**Biais trouvés à la main et corrigés avant tout envoi.** Une holding à 1 Md€ de CA déclarée « 1-2 salariés » passait
pour une micro-entreprise : la définition INSEE (CA ≤ 2 M€, ni ETI ni grande entreprise) l'écarte désormais.
Des comptes de 2017 faisaient dire « rentable » : seuls les comptes de moins de trois ans comptent (336 → 178).
Des filiales de groupes (Eiffage…) arrivaient en tête chez un courtier de PME : seule la catégorie INSEE « PME » reste
(327 écartées). Une immatriculation récente peut être une reprise : le brouillon le dit au lieu de l'affirmer.
Limites consignées au registre (actes `aveu`) : lecture BTP incomplète, Bruxelles non couvert.

**Argent encaissé : 0 €.** Aucune proposition n'est encore partie.

## Gestes du propriétaire (rien ne part sans lui)

1. Un compte freelance sur codeur.com (l'inscription est annoncée gratuite ; la limite de réponses n'est pas connue).
2. Relire `prive/brouillon-*.md`, fixer le prix (laissé en blanc exprès), envoyer, puis `node bin/velyx.js envoye <pari>`.
3. Consigner l'issue (`reponse <pari> <issue>`) ; un premier paiement suppose un statut pour facturer
   (micro-entreprise, par exemple) : c'est sa décision.

## Règles

- Une recette répond à une annonce réelle ; chaque signal cite la règle publique ou le critère écrit par le client.
- Un brouillon naît avec son pari : critère de succès et critère d'arrêt écrits **avant** l'envoi.
- Le registre (`registre/journal.jsonl`) est en ajout seul et chaîné ; il refuse un envoi, un encaissement ou une
  dépense qui ne viennent pas du propriétaire.
- Aucun chiffre sans source datée ; « inconnu » plutôt qu'une estimation.
