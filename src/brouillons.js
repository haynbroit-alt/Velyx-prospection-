// Propositions « preuve d'abord » : on répond à une demande publiée avec un échantillon réel déjà construit pour elle.
// Ce sont des BROUILLONS : rien ne part sans le propriétaire, et chaque prix est marqué « à valider par lui ».
const eur = (n) => (n == null ? '—' : `${Math.round(n).toLocaleString('fr-FR')} €`);
const ligne = (e) => `- ${e.nom} — ${e.commune} (${e.departement}) · ${e.effectif} sal. · créée le ${e.creation} · CA ${e.ca?.ca ? `${eur(e.ca.ca)} (${e.ca.annee})` : 'non publié'} · ${e.signaux.map((s) => s.court).join(' · ') || 'sans signal prioritaire'}`;

export const MODELES = {
  'rachat-it-idf': (d, c) => `Bonjour,

Pour identifier des cibles de rachat de portefeuille, j'ai interrogé le registre officiel des entreprises (SIRENE et
registre national des entreprises) avant de vous écrire, plutôt que de vous décrire une méthode.

En Île-de-France, ${c.retenues} sociétés de services informatiques (codes NAF 62.01Z à 62.09Z) comptent moins de
5 salariés, sont des micro-entreprises au sens de l'INSEE et ont un dirigeant âgé de 62 ans ou plus — le moment où la
question de la transmission se pose, sans repreneur interne possible dans une si petite structure.
Parmi elles, ${c.par_signal.portefeuille ?? 0} existent depuis plus de 15 ans et ${c.par_signal.rentable ?? 0} ont publié un résultat positif sur les
trois dernières années.

Voici les dix premières, à titre d'échantillon (données publiques, consultées le ${d.lu_le.slice(0, 10)}) :

${d.cibles.slice(0, 10).map(ligne).join('\n')}

Ce que je propose :
1. la liste complète, classée par ces signaux, avec la fiche officielle de chaque société ;
2. la qualification des 30 premières (activité réelle, type de clientèle, site, signes de départ) ;
3. une première prise de contact avec les dirigeants retenus, selon le message que vous validez.

Limite à connaître : Bruxelles n'est pas couvert par ce registre ; il faudrait le registre belge (BCE), que je n'ai pas
encore interrogé.

[PRIX À VALIDER PAR LE PROPRIÉTAIRE — ex. : étapes 1 et 2 au forfait, étape 3 à la journée]

Bien cordialement,
[NOM DU PROPRIÉTAIRE]`,

  'courtier-btp-aura': (d, c) => `Bonjour,

Avant de décrocher le téléphone, j'ai regardé qui appeler en priorité, à partir de vos propres critères et du registre
officiel des entreprises (SIRENE et registre national des entreprises).

Dans vos huit départements (Rhône, Isère, Loire, Ain, Savoie, Haute-Savoie, Drôme, Ardèche), ${d.complet ? '' : 'au moins '}${c.retenues} PME
actives de vos métiers comptent entre 6 et 99 salariés. Parmi elles :
- ${c.par_signal.recente ?? 0} ont été immatriculées il y a moins de trois ans (créations ou reprises) — votre premier cas
  prioritaire, « entreprise récente » ; la décennale doit être justifiée à l'ouverture de tout chantier
  (C. assurances, art. L241-1) ;
- ${c.par_signal.rge ?? 0} sont qualifiées RGE, donc sur les activités que vous citez (photovoltaïque, isolation, PAC) ;
- ${c.par_signal.operation ?? 0} sont promoteurs ou constructeurs (dommages-ouvrage, TRC, GFA à chaque opération).
Pour ${c.completes} d'entre elles, le chiffre d'affaires et le nom du dirigeant — deux des champs que vous exigez pour
chaque rendez-vous — sont déjà renseignés depuis les comptes publiés.

Échantillon des dix premières (données publiques, consultées le ${d.lu_le.slice(0, 10)}) :

${d.cibles.slice(0, 10).map(ligne).join('\n')}

Ce que je propose, au choix :
A. ce fichier classé, mis à jour chaque mois avec les nouvelles immatriculations, pour vos téléprospecteurs ;
B. la prise de rendez-vous elle-même sur ces cibles, selon vos conditions (125 € TTC par rendez-vous honoré).

[CHOIX ET PRIX À VALIDER PAR LE PROPRIÉTAIRE]

Bien cordialement,
[NOM DU PROPRIÉTAIRE]`,
};
