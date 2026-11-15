// Recettes de ciblage. Chacune répond à UNE demande réelle publiée, et chaque signal cite la règle publique ou la
// priorité écrite par le client qui le justifie. Aucun score inventé : on compte des signaux vérifiables.
const AN = new Date().getFullYear();
const ageAns = (date) => (date ? (Date.now() - Date.parse(date)) / (365.25 * 864e5) : null);
const PRINCIPAUX = /président|gérant|directeur général|dirigeant|exploitant/i;

const BTP_NAF = ['43.99C', '41.20A', '41.20B', '43.12A', '43.12B', '43.11Z', '43.91A', '43.91B', '43.99A', '43.32A', '43.32B',
  '43.31Z', '43.33Z', '43.34Z', '43.29A', '43.39Z', '43.21A', '43.22A', '43.22B', '43.29B', '41.10A', '42.11Z', '42.21Z', '71.12B'];
const AURA = ['69', '38', '42', '01', '73', '74', '26', '07'];
const IDF = ['75', '77', '78', '91', '92', '93', '94', '95'];

export const RECETTES = {
  'courtier-btp-aura': {
    annonce: 'https://www.codeur.com/projects/492531-prise-de-rdv-physiques-entreprises-du-btp-rhone-alpes',
    besoin: 'Rendez-vous physiques avec des dirigeants du BTP (5 à 100 salariés) en Rhône-Alpes ; priorité aux entreprises récentes, aux nouvelles activités (photovoltaïque, isolation par l’extérieur) et aux promoteurs ; CA et nom du dirigeant exigés pour chaque rendez-vous.',
    params: { activite_principale: BTP_NAF.join(','), departement: AURA.join(','), tranche_effectif_salarie: '03,11,12,21', etat_administratif: 'A' },
    // Catégorie INSEE « PME » seulement : les filiales d'ETI et de grands groupes s'assurent au niveau du groupe.
    garder: (e) => AURA.includes(e.departement) && e.categorie === 'PME',
    rang: (e) => 10 * e.signaux.some((s) => s.code === 'recente') + e.signaux.length,
    signaux: (e) => {
      const s = [], age = ageAns(e.creation);
      if (age !== null && age < 3) s.push({ code: 'recente', court: 'récente', texte: `immatriculée il y a ${age < 1 ? 'moins d’un an' : `${Math.floor(age)} an(s)`} (création ou reprise, à vérifier) : peut relever du cas « entreprise récente » que le client cite en premier ; la décennale doit être justifiée à l’ouverture de tout chantier (C. assurances, art. L241-1)` });
      if (e.rge) s.push({ code: 'rge', court: 'RGE', texte: 'qualifiée RGE (rénovation énergétique) : activités que le client cite comme à faire assurer (photovoltaïque, isolation, PAC)' });
      if (/^41\.(10|20)/.test(e.naf)) s.push({ code: 'operation', court: 'promoteur/constructeur', texte: 'promoteur ou constructeur : chaque opération exige dommages-ouvrage, tous risques chantier ou garantie d’achèvement' });
      return s;
    },
    complet: (e) => Boolean(e.ca?.ca && e.dirigeants.some((d) => PRINCIPAUX.test(d.qualite))),
  },
  'rachat-it-idf': {
    annonce: 'https://www.codeur.com/projects/492253-prospection-et-developpement-externe-ile-de-france-bruxelles',
    besoin: 'Identifier des indépendants et micro-entreprises IT (moins de 5 salariés) en Île-de-France pour des partenariats ou le rachat de portefeuilles clients.',
    params: { activite_principale: '62.01Z,62.02A,62.03Z,62.09Z', region: '11', tranche_effectif_salarie: '00,01,02', etat_administratif: 'A', date_naissance_personne_max: `${AN - 62}-12-31` },
    // Micro-entreprise au sens INSEE (décret 2008-1354) : moins de 10 salariés et CA ≤ 2 M€. Écarte les holdings
    // dont l'effectif déclaré est minuscule mais le CA consolidé énorme.
    garder: (e) => IDF.includes(e.departement) && !['GE', 'ETI'].includes(e.categorie) && !(e.ca?.ca > 2e6) && e.dirigeants.some((d) => PRINCIPAUX.test(d.qualite) && d.annee_naissance && d.annee_naissance <= AN - 62),
    signaux: (e) => {
      const s = [], doyen = Math.min(...e.dirigeants.filter((d) => PRINCIPAUX.test(d.qualite) && d.annee_naissance).map((d) => d.annee_naissance));
      s.push({ code: 'transmission', court: `dirigeant ${AN - doyen} ans`, texte: `dirigeant né en ${doyen} (${AN - doyen} ans) : question de la transmission ouverte, sans repreneur interne dans une structure de moins de 5 salariés` });
      const age = ageAns(e.creation);
      if (age !== null && age >= 15) s.push({ code: 'portefeuille', court: `${Math.floor(age)} ans d’existence`, texte: `société créée il y a ${Math.floor(age)} ans : clientèle installée` });
      if (e.ca?.resultat_net > 0 && e.ca.annee >= AN - 3) s.push({ code: 'rentable', court: `bénéficiaire ${e.ca.annee}`, texte: `résultat net publié positif (${e.ca.annee}) : portefeuille rentable` });
      return s;
    },
    complet: (e) => e.dirigeants.length > 0,
  },
};

export function appliquer(recette, entreprises) {
  const gardees = entreprises.filter(recette.garder).map((e) => ({ ...e, signaux: recette.signaux(e), complet: recette.complet(e) }));
  const rang = recette.rang ?? ((e) => e.signaux.length);
  gardees.sort((a, b) => rang(b) - rang(a) || Number(b.complet) - Number(a.complet) || (b.ca?.ca ?? 0) - (a.ca?.ca ?? 0));
  const parSignal = {};
  for (const e of gardees) for (const s of e.signaux) parSignal[s.code] = (parSignal[s.code] || 0) + 1;
  return { gardees, compte: { retenues: gardees.length, avec_signal: gardees.filter((e) => e.signaux.length).length, completes: gardees.filter((e) => e.complet).length, par_signal: parSignal } };
}
