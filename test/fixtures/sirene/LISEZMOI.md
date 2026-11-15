# Fiches SIRENE brutes (FICTIVES)

`fiches-brutes.json` : trois fiches **inventées** au format de l'API publique recherche-entreprises.api.gouv.fr
(clés relevées le 15/11/2026). SIREN `9990000xx` à clé de Luhn fausse (aucune entreprise réelle) ; noms inventés.
Cas couverts : opposition à la prospection (`opposition_diffusion_commerciale`), diffusion partielle (`statut_diffusion`
« P »), entreprise cessée (`etat_administratif` « C », `date_fermeture`), dirigeant personne morale, commissaires aux
comptes (personne physique et personne morale), `date_de_naissance` et `nationalite` présentes (à ne jamais garder),
quatre exercices publiés (trois gardés), IDCC.
