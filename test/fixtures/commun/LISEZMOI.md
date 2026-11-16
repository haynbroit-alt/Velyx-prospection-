# Fixtures communes (FICTIVES)

`entreprises.json` : 20 fiches **inventées** au format `Entreprise` (voir `src/contrats.js`), partagées par les tests
des modules M4 à M7. Aucune ne décrit une entreprise ou une personne réelle :

- les SIREN (`9990000xx`) ont une clé de Luhn volontairement fausse : aucun ne peut être celui d'une entreprise réelle ;
- les noms de dirigeants et d'entreprises sont inventés ; « Zéphyrin CANARIX » est le **canari** de l'antifuite : on ne
  doit jamais le retrouver dans `etat/`, `registre/`, le site ou un échantillon montré à un tiers.

Chaque fiche porte `opposition` (booléen) et `statut_diffusion` (« O ») comme le rend `sirene.resumer` : une fiche sans
l'un de ces champs est exclue (G4, G11 en échec fermé) et L5 le compte comme manquant.

Cas couverts : canari (n° 1, nom de société qui contient celui du dirigeant), holding à 50 M€ déclarée 1-2 salariés
(n° 2), comptes de 2019 (n° 3), opposition à la prospection (n° 4), dirigeant de 101 ans (n° 5), entrepreneur individuel,
nature 1000 (n° 6), promoteur 41.10A à 15 M€ pour 6-9 salariés (n° 7), co-gérante de 41 ans (n° 8), entreprise fermée
(n° 9), filiale d'ETI à dirigeant personne morale (n° 10), BTP créées en 2025 et 2026, dont un effectif non daté
(n° 11 et 12), effectif ancien (n° 13), deux courtiers 66.22Z « construction » et « BTP » (n° 16 et 17), holding 70.10Z
(n° 18), CA publié 0 avec résultat non nul (n° 19), CA 0 et résultat 0 (n° 20).
