// Tests de src/brouillons.js (M6). Hors réseau ; toutes les entreprises et personnes ci-dessous sont FICTIVES.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { creerHorloge } from '../src/socle.js';
import { jetonsDe, minimiser, nombresDuTexte, controlerBrouillon } from '../src/controles.js';
import { RECETTES, compiler, appliquer, chiffresRecette } from '../src/recettes.js';
import {
  GABARITS, PLACEHOLDERS_OBLIGATOIRES, REPERES_PRIX, NOTES_PROPRIETAIRE, MODELES, TYPES_GABARIT, remplir, validerGabaritLLM,
  ligneEchantillon, preparer, pari, echantillonMinimise,
} from '../src/brouillons.js';

const F = JSON.parse(fs.readFileSync(new URL('./fixtures/commun/entreprises.json', import.meta.url), 'utf8'));
const H = creerHorloge('2026-11-15T21:00:00Z');
const fr = (n) => n.toLocaleString('fr-FR');
const LECTURE = { complet: true, lu_le: H.iso() };
const SOURCES = { compte: 'prive/listes/essai.json', param: 'etat/recettes/essai.json', sonde: 'acte observation n° fictif' };

// Douze créations BTP fictives en Haute-Savoie : une opposée, une en diffusion partielle, une EI.
const COMMUNES = ['ANNECY', 'THONON-LES-BAINS', 'CLUSES', 'SALLANCHES', 'ANNEMASSE', 'RUMILLY', 'EVIAN-LES-BAINS', 'SEYNOD', 'PASSY', 'BONNEVILLE', 'FAVERGES', 'MEGEVE'];
const PRENOMS = ['Ondine', 'Barnabé', 'Clovis', 'Eulalie', 'Basile', 'Philomène', 'Gratien', 'Léocadie', 'Anatole', 'Zélie', 'Hilarion', 'Perrine'];
const NOMS = ['VERGLASSE', 'TOITURIN', 'MOELLONET', 'CHAUXELLE', 'FICTIFOR', 'ENDUIRAC', 'CHARPENTOT', 'CARRELINE', 'PLATRIER', 'ZINGUELLE', 'BETONNIC', 'ISOLETTE'];
const CREES = COMMUNES.map((commune, i) => ({
  siren: `9990009${String(i + 10)}`, nom: i === 4 ? `${NOMS[i]} ${PRENOMS[i].toUpperCase()}` : `ENTREPRISE FICTIVE ${String.fromCharCode(65 + i)} BATIMENT`,
  nature_juridique: i === 4 ? '1000' : '5710', naf: ['43.22A', '43.99C', '43.29A', '41.20A', '43.21A', '43.32A'][i % 6],
  creation: `2026-0${(i % 9) + 1}-1${i % 9}`, etat_administratif: 'A', fermee: false, categorie: 'PME', effectif: i % 3 ? '1-2' : 'non renseigné',
  effectif_code: i % 3 ? '01' : 'NN', effectif_annee: i % 3 ? 2026 : null, departement: '74', commune,
  dirigeants: [{ qualite: 'Président', nom: `${PRENOMS[i]} ${NOMS[i]}`, annee_naissance: 1980 + i }], dirigeants_pm: 0,
  finances: [], ca: null, rge: i % 2 === 0, idcc: i % 4 === 0 ? ['1597'] : [], opposition: i === 2, statut_diffusion: i === 7 ? 'P' : 'O',
  etablissements_ouverts: 1, fiche: `https://annuaire-entreprises.data.gouv.fr/entreprise/9990009${String(i + 10)}`,
}));

test('lecture incomplète → « au moins » inséré même si le gabarit l’oublie, jamais en double', () => {
  const d = { compte: { retenues: 5037 }, lecture: { complet: false, lu_le: H.iso() }, sources: SOURCES };
  assert.equal(remplir('{{compte.retenues}} PME', d).texte, `au moins ${fr(5037)} PME`);
  assert.equal(remplir('{{au_moins}}{{compte.retenues}} PME', d).texte, `au moins ${fr(5037)} PME`);
  assert.equal(remplir('au moins {{compte.retenues}} PME', d).texte, `au moins ${fr(5037)} PME`);
  assert.equal(remplir('{{au_moins}}{{compte.retenues}} PME', { ...d, lecture: LECTURE }).texte, `${fr(5037)} PME`);
  const r = remplir('{{compte.retenues}} PME, lu le {{lu_le}}', d);
  assert.deepEqual(r.chiffres, { 'compte.retenues': 5037 });
  assert.equal(r.provenance['compte.retenues'], SOURCES.compte);
  assert.match(r.empreinte, /^[0-9a-f]{16}$/);
});

test('remplir lève sur un placeholder inconnu, non résolu ou sans provenance', () => {
  assert.throws(() => remplir('{{prix}}', { lecture: LECTURE }), /inconnu/);
  assert.throws(() => remplir('{{compte.inexistant}}', { compte: {}, lecture: LECTURE, sources: SOURCES }), /non résolu/);
  assert.throws(() => remplir('{{compte.retenues}}', { compte: { retenues: 3 }, lecture: LECTURE }), /provenance manquante/);
  assert.throws(() => remplir('{{compte.retenues}}', { compte: { retenues: 3 }, sources: SOURCES }), /d\.lecture/);
  assert.throws(() => remplir('{{annonce.url}}', { annonce: { url: 'https://exemple.fr/x' } }), /non résolu/);
  assert.throws(() => remplir('{{echantillon.lignes}}', { echantillon: { lignes: [] } }), /non résolu/);
  assert.throws(() => remplir('texte {{ mal', {}), /mal formé/);
});

test('gabarit IT rempli avec les comptes contrôlés du 15/11 → 694, 312, 151 (et non 862, 378, 178)', () => {
  const r = RECETTES['rachat-it-idf'];
  const lignes = echantillonMinimise(F.slice(13, 14).map((e) => ({ ...e, controle: { statut: 'retenue' } })), { horloge: H, dict: jetonsDe(F) });
  const p = preparer('rachat-it-idf', { compte: { retenues: 694, par_signal: { portefeuille: 312, rentable: 151 } }, params: chiffresRecette(r),
    lecture: LECTURE, echantillon: { lignes }, limites: r.limites, sources: SOURCES }, { horloge: H, dict: jetonsDe(F) });
  for (const x of [694, 312, 151]) assert.ok(p.texte.includes(fr(x)), String(x));
  for (const x of [862, 378, 178]) assert.ok(!p.texte.includes(fr(x)), String(x));
  assert.equal(p.ok, true, JSON.stringify(p.controles.filter((c) => !c.ok)));
  assert.match(p.texte, /62 ans ou plus/);
});

test('validerGabaritLLM : placeholder prix supprimé refusé ; « 450 € » hors citation refusé ; citation de l’annonce acceptée', () => {
  const bon = `Bonjour, {{au_moins}}{{compte.retenues}} entreprises correspondent à votre demande « base de 150 entreprises du BTP ».\n{{echantillon.lignes}}\n[PRIX À VALIDER PAR LE PROPRIÉTAIRE]\n[NOM DU PROPRIÉTAIRE]`;
  const annonce_description = 'Constituer une base de 150 entreprises du BTP, budget 800 € HT.';
  assert.deepEqual(validerGabaritLLM(bon, { annonce_description }), { ok: true, erreurs: [] });
  assert.equal(validerGabaritLLM(bon.replace('[PRIX À VALIDER PAR LE PROPRIÉTAIRE]', ''), { annonce_description }).ok, false);
  assert.equal(validerGabaritLLM(bon.replace('[NOM DU PROPRIÉTAIRE]', 'Jean'), { annonce_description }).ok, false);
  assert.equal(validerGabaritLLM(`${bon}\nTarif « 450 € ».`, { annonce_description }).ok, false);
  assert.equal(validerGabaritLLM(`${bon}\nBudget cité : « 800 € HT ».`, { annonce_description }).ok, true);
  assert.equal(validerGabaritLLM(`${bon}\nNous avons 1200 fiches.`, { annonce_description }).ok, false, 'chiffre hors placeholder');
  assert.equal(validerGabaritLLM(bon, {}).ok, false, 'citation non vérifiable sans description');
  assert.equal(validerGabaritLLM(`${bon} {{prix.total}}`, { annonce_description }).ok, false, 'placeholder inconnu');
  assert.equal(validerGabaritLLM(`${bon} voir https://exemple.fr`, { annonce_description }).ok, false, 'URL hors codeur');
  assert.equal(validerGabaritLLM(`${bon} résultat garanti`, { annonce_description }).ok, false, 'promesse');
  assert.equal(validerGabaritLLM(`${bon}${' x'.repeat(2100)}`, { annonce_description }).ok, false, 'trop long');
});

test('ligneEchantillon ne contient ni le jeton canari ni une année de naissance', () => {
  const canari = F[0];
  const l = ligneEchantillon(minimiser({ ...canari, signaux: [{ court: 'dirigeant 62 ans ou plus' }] }, H, jetonsDe(F), { alias: 'S01' }));
  assert.doesNotMatch(l, /CANARIX|Zéphyrin|1958/i);
  assert.match(l, /^S01 · département 75 · NAF 62\.02A · 1-2 sal\. · créée en 1997 · CA 2025 publié · dirigeant 62 ans ou plus$/);
  const btp = ligneEchantillon(minimiser({ ...F[7], signaux: [{ court: 'RGE' }] }, H, null, { alias: 'S03' }));
  assert.equal(btp, 'S03 · Grenoble (38) · NAF 43.22A · 10-19 sal. · créée en 2006 · CA 2025 publié · RGE');
  assert.match(ligneEchantillon(minimiser(F[2], H, null, { alias: 'S02' })), /CA ancien \(2019\)/);
  assert.match(ligneEchantillon(minimiser(F[10], H, null, { alias: 'S04' })), /effectif inconnu · créée en 2025 · CA non publié/);
});

test('preuve-legere BTP : {sonde.total_brut: 6778, rge: 1981} rendus dans des phrases qui contiennent « brut »', () => {
  const lignes = echantillonMinimise([{ ...F[7], controle: { statut: 'retenue' } }], { horloge: H, dict: jetonsDe(F) });
  const d = { sonde: { total_brut: 6778, rge: 1981, lu_le: H.iso(), libelles: { rge: 'qualifiées RGE' } }, lecture: LECTURE, limites: [],
    echantillon: { lignes, lues: 50, ecartees: 17, pages: [12, 87], graine: 'C-2026-11-15' }, annonce: { url: 'https://www.codeur.com/projects/492531-prise-de-rdv' }, sources: SOURCES };
  const annonce = { statut: 'Ouvert', lu_le: H.iso(), description: 'prise de rendez-vous BTP' };
  const p = preparer('preuve-legere', d, { horloge: H, dict: jetonsDe(F), annonce });
  for (const v of [6778, 1981]) {
    const ligne = p.texte.split('\n').find((l) => l.includes(fr(v)));
    assert.ok(ligne && /brut/.test(ligne), `${v} : ${ligne}`);
  }
  assert.equal(p.ok, true, JSON.stringify(p.controles.filter((c) => !c.ok)));
  const sansBrut = p.texte.replace(/total brut de/g, 'total de');
  assert.equal(controlerBrouillon(sansBrut, { chiffres: p.chiffres, horloge: H, codes: ['B8'] })[0].ok, false);
});

test('e-mail B2B courtiers-construction : objet métier, expéditeur, notice art. 14, opposition, 10 lignes minimisées de btp-creations-zone', () => {
  const r = compiler(RECETTES['btp-creations-zone'].spec, H, { departement: '74' });
  const { gardees, exclues, compte } = appliquer(r, CREES, { horloge: H, oppositions: new Set(), lecture: { complet: false, lu_le: H.iso() } });
  assert.equal(gardees.length, 10);
  assert.equal(exclues.length, 2, 'opposée et diffusion partielle');
  const dict = jetonsDe(CREES);
  const lignes = echantillonMinimise(gardees, { horloge: H, dict });
  const p = preparer('courtiers-construction', { compte, params: chiffresRecette(r), lecture: { complet: false, lu_le: H.iso() }, limites: r.limites,
    echantillon: { lignes, departement: '74' }, sources: SOURCES }, { horloge: H, dict });
  assert.equal(p.ok, true, JSON.stringify(p.controles.filter((c) => !c.ok)));
  const t = p.texte;
  assert.match(t.split('\n')[0], /^Objet : .*bâtiment.*décennale/);
  for (const attendu of ['[NOM DU PROPRIÉTAIRE]', '[STATUT ET COORDONNÉES DU PROPRIÉTAIRE]', 'art. 14 du RGPD', '« STOP »', '[ADRESSE D’OPPOSITION DU PROPRIÉTAIRE]', 'NAF 66.22Z', 'art. L241-1', 'département 74', 'au moins ', 'aucune commission']) {
    assert.ok(t.includes(attendu), attendu);
  }
  const echantillon = t.split('\n').filter((l) => /^- S\d{2} · /.test(l));
  assert.equal(echantillon.length, 10);
  for (const nom of [...NOMS, ...PRENOMS]) assert.ok(!t.toUpperCase().includes(nom.toUpperCase()), 'aucun nom de dirigeant');
  assert.ok(!t.includes('CLUSES') && !/Cluses/.test(t), 'commune de la société opposée absente');
  assert.ok(!/Seynod/.test(t), 'commune de la société en diffusion partielle absente');
  assert.ok(!/Annemasse/.test(t), 'commune d’une EI jamais montrée');
  assert.doesNotMatch(t, /€|\d{9}/);
  assert.ok(lignes.every((m) => m.statut === 'retenue'));
  assert.match(p.notes, /Repères de prix/);
  // Une commune homonyme ne bloque pas, mais un nom de dirigeant ajouté au texte, si.
  assert.equal(controlerBrouillon(`${t}\nContact : ${PRENOMS[0]} ${NOMS[0]}`, { dict, horloge: H, codes: ['B7'] })[0].ok, false);
});

test('repères de prix : cités avec leur source dans les notes privées, jamais dans un texte', () => {
  assert.ok(REPERES_PRIX.length >= 5);
  for (const r of REPERES_PRIX) assert.ok(r.repere && r.prix_cite && r.usage);
  assert.match(NOTES_PROPRIETAIRE['courtiers-construction'], /Marché fichiers prospection à signaux/);
  for (const [id, g] of Object.entries(GABARITS)) {
    assert.doesNotMatch(g, /€|\beuros?\b|\$/, id);
    assert.deepEqual(nombresDuTexte(g.replace(/\{\{[^}]+\}\}/g, ' ')).map((x) => x.brut), [], `${id} : aucun chiffre hors placeholders`);
    if (TYPES_GABARIT[id] !== 'prealable') for (const ph of PLACEHOLDERS_OBLIGATOIRES) assert.ok(g.includes(ph), `${id} : ${ph}`);
  }
});

test('kits et préalables : contrôlés sans données de liste, donc sans dictionnaire', () => {
  for (const id of ['kit-comeup', 'kit-malt', 'prealable-statut', 'prealable-canal', 'prealable-cgu']) {
    const p = preparer(id, {}, { horloge: H });
    assert.equal(p.ok, true, `${id} : ${JSON.stringify(p.controles.filter((c) => !c.ok))}`);
  }
  assert.equal(preparer('kit-comeup', {}, { horloge: H }).controles.some((c) => c.code === 'B4'), false);
});

test('pari : critères écrits avant l’envoi, lié à la croyance B06', () => {
  const p = pari({ id: 'R-2026-11-16-1', canal: 'email' });
  assert.equal(p.id, 'P-R-2026-11-16-1');
  assert.deepEqual(p.croyances, ['B06']);
  assert.equal(p.critere_succes, 'issue ∈ {devis_demande, echange, commande, paye} au plus 7 j après l’envoi');
  assert.equal(p.critere_arret, 'après 7 j sans issue positive, demander l’issue au propriétaire ; le pari n’est perdu que sur son acte');
  assert.equal(p.echeance, 'envoi + 7 jours');
  assert.match(p.geste_proprietaire, /velyx envoye P-R-2026-11-16-1 --canal email/);
  for (const k of ['hypothese', 'geste_proprietaire', 'critere_succes', 'critere_arret', 'echeance']) assert.ok(p[k], k);
  assert.throws(() => pari({ id: 'X' }), /revue/);
});

test('compatibilité bin/velyx.js : MODELES refuse une liste v1 sans oppositions et produit un texte contrôlé sinon', () => {
  const r = RECETTES['rachat-it-idf'];
  const v1 = { annonce: r.annonce, lu_le: new Date().toISOString(), complet: true, cibles: F.slice(0, 3).map(({ opposition, ...e }) => e) };
  assert.throws(() => MODELES['rachat-it-idf'](v1, { retenues: 3, par_signal: {} }), /opposition/);
  const res = appliquer(r, F, { oppositions: new Set() });
  const liste = { annonce: r.annonce, lu_le: new Date().toISOString(), complet: true, cibles: res.gardees };
  const texte = MODELES['rachat-it-idf'](liste, res.compte);
  assert.doesNotMatch(texte, /BLOQUÉ/);
  assert.ok(texte.includes(`${fr(res.compte.retenues)} sociétés`));
  assert.doesNotMatch(texte.split('NOTES POUR LE PROPRIÉTAIRE')[0], /€/);
  for (const e of F) for (const d of e.dirigeants) assert.ok(!texte.includes(d.nom), 'aucun nom de dirigeant');
  const vieille = MODELES['rachat-it-idf']({ ...liste, lu_le: '2026-01-01T00:00:00Z' }, res.compte);
  assert.match(vieille, /^<!-- BLOQUÉ.*B4/);
});

const IT_BRUT = fileURLToPath(new URL('../prive/rachat-it-idf-2026-11-15.brut.json', import.meta.url));
test('local : brouillon IT du 15/11 rempli par la chaîne réelle → 694, 312, 151', { skip: !fs.existsSync(IT_BRUT) && 'prive/ absent' }, async () => {
  const { resumer } = await import('../src/sources/sirene.js');
  const brut = JSON.parse(fs.readFileSync(IT_BRUT, 'utf8'));
  const fiches = brut.fiches.map(resumer);
  if (fiches[0].opposition === undefined) return;                     // sirene.js sans les champs v2 : rien à vérifier
  const r = compiler(RECETTES['rachat-it-idf'].spec, H);
  const res = appliquer(r, fiches, { horloge: H, oppositions: new Set(), lecture: { complet: brut.complet, total: brut.total } });
  const dict = jetonsDe(fiches);
  const p = preparer('rachat-it-idf', { compte: res.compte, params: chiffresRecette(r), lecture: { complet: brut.complet, lu_le: brut.lu_le },
    echantillon: { lignes: echantillonMinimise(res.gardees, { horloge: H, dict }) }, limites: r.limites, sources: SOURCES }, { horloge: H, dict });
  for (const x of [694, 312, 151]) assert.ok(p.texte.includes(fr(x)), String(x));
  assert.equal(p.controles.find((c) => c.code === 'B7').ok, true, 'aucun nom de dirigeant dans le brouillon');
  assert.equal(p.controles.find((c) => c.code === 'B1').ok, true);
});
