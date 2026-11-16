// Tests de src/controles.js (M4). Hors réseau ; fixtures fictives (test/fixtures/commun/entreprises.json). Le dernier
// test relit les listes réelles du 15/11 dans prive/ et n'affiche que des comptes ; il est sauté si prive/ est absent.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { creerHorloge } from '../src/socle.js';
import {
  CONTROLES, controlerFiche, controlerListe, controlerBrouillon, compilerRegle, chargerRegles, echantillonControle,
  evaluerRevueEchantillon, minimiser, jetonsDe, estExclue, etatCa, listeBloquee, PLACEHOLDERS, scannerTexte,
} from '../src/controles.js';

const F = JSON.parse(fs.readFileSync(new URL('./fixtures/commun/entreprises.json', import.meta.url), 'utf8'));
const n = (i) => structuredClone(F[i - 1]);                  // fiche n° i des fixtures (1 à 20)
const H = creerHorloge('2026-11-15T21:00:00Z');
const MICRO = { cible_taille: 'micro', vise_dirigeant: false, exceptions_ratio: [] };
const BTP = { cible_taille: 'pme', vise_dirigeant: true, exceptions_ratio: ['41.10A', '41.20A', '41.20B'] };
const TOUTES = { cible_taille: 'toutes', vise_dirigeant: false, exceptions_ratio: [] };
const ctx = { horloge: H, oppositions: new Set() };
const PH = PLACEHOLDERS.map((p) => (p.endsWith(']') ? p : `${p}]`)).join('\n');

test('catalogue : codes uniques, chacun avec portée, gravité et date', () => {
  const codes = CONTROLES.map((c) => c.code);
  assert.equal(new Set(codes).size, codes.length);
  for (const c of CONTROLES) { assert.ok(['fiche', 'liste', 'brouillon'].includes(c.portee)); assert.ok(['bloquant', 'alerte'].includes(c.gravite)); assert.equal(c.depuis, '2026-11-15'); }
  assert.throws(() => { CONTROLES.push({}); });
});

test('G1 : holding à 50 M€ pour 1-2 salariés (recette micro) en quarantaine ; promoteur 41.10A à 15 M€ retenu sans drapeau', () => {
  const holding = controlerFiche(n(2), MICRO, ctx);
  assert.equal(holding.statut, 'quarantaine');
  assert.ok(holding.codes.includes('G1'));
  const promoteur = controlerFiche(n(7), BTP, ctx);
  assert.equal(promoteur.statut, 'retenue');
  assert.deepEqual(promoteur.drapeaux, []);
  // Le même ratio hors exception n'est qu'une alerte : la fiche reste retenue.
  const bureau = controlerFiche({ ...n(7), naf: '71.12B' }, BTP, ctx);
  assert.equal(bureau.statut, 'retenue');
  assert.ok(bureau.drapeaux.includes('ca_par_salarie_eleve'));
  assert.equal(controlerFiche(n(18), TOUTES, ctx).statut, 'quarantaine', 'NAF 70.10Z, nom PARTICIPATIONS');
});

test('G2 : comptes de 2019 → libellé « CA ancien (2019) », drapeau comptes_perimes', () => {
  const v = controlerFiche(n(3), MICRO, ctx);
  assert.ok(v.drapeaux.includes('comptes_perimes'));
  assert.equal(v.ca.statut, 'ancien');
  assert.equal(v.ca.libelle, 'CA ancien (2019)');
  assert.equal(etatCa(n(1), H).statut, 'publie');
});

test('G3 : ETI exclue d’une cible PME ; dirigeant personne morale → filiale_probable, quarantaine si la recette vise le dirigeant', () => {
  assert.equal(controlerFiche(n(10), BTP, ctx).statut, 'exclue');
  const pm = { ...n(13), dirigeants_pm: 1 };
  assert.ok(controlerFiche(pm, { ...BTP, vise_dirigeant: false }, ctx).drapeaux.includes('filiale_probable'));
  assert.equal(controlerFiche(pm, { ...BTP, vise_dirigeant: false }, ctx).statut, 'retenue');
  assert.equal(controlerFiche(pm, BTP, ctx).statut, 'quarantaine');
});

test('G4 : opposition → exclue quelle que soit la recette, et ne se neutralise pas', () => {
  for (const r of [MICRO, BTP, TOUTES, {}]) assert.equal(controlerFiche(n(4), r, ctx).statut, 'exclue');
  // Opposition reçue (mémoire privée) sur une fiche non marquée au registre.
  assert.equal(controlerFiche(n(14), MICRO, { horloge: H, oppositions: new Set([n(14).siren]) }).statut, 'exclue');
  assert.equal(estExclue(n(14), new Set()), false);
  assert.throws(() => controlerFiche(n(4), MICRO, { ...ctx, neutraliser: ['G4'] }), /non neutralisable/);
  assert.throws(() => controlerListe([n(4)], {}, MICRO, { ...ctx, neutraliser: ['G2', 'G4'] }), /non neutralisable/);
});

test('G11 : diffusion partielle « P » → exclue, non neutralisable', () => {
  assert.equal(controlerFiche({ ...n(14), statut_diffusion: 'P' }, MICRO, ctx).statut, 'exclue');
  assert.equal(controlerFiche({ ...n(14), statut_diffusion: 'O' }, MICRO, ctx).statut, 'retenue');
  assert.throws(() => controlerFiche(n(14), MICRO, { ...ctx, neutraliser: ['G11'] }), /non neutralisable/);
});

test('G4 et G11 en échec fermé : opposition ou statut de diffusion absent (null, undefined) → exclue', () => {
  for (const opposition of [null, undefined, 'non']) {
    const v = controlerFiche({ ...n(14), opposition }, MICRO, ctx);
    assert.equal(v.statut, 'exclue', String(opposition));
    assert.ok(v.codes.includes('G4'));
    assert.match(v.motifs.find((m) => m.code === 'G4').motif, /inconnue/);
    assert.equal(estExclue({ ...n(14), opposition }, new Set()), true);
  }
  for (const statut_diffusion of [null, undefined, '']) {
    const v = controlerFiche({ ...n(14), statut_diffusion }, MICRO, ctx);
    assert.equal(v.statut, 'exclue', String(statut_diffusion));
    assert.ok(v.codes.includes('G11'));
  }
});

test('G5 : CA 0 et résultat 22 710 → CA non publié (jamais « 0 € ») ; CA 0 et résultat 0 → activite_nulle_declaree', () => {
  const zero = { ...n(19), finances: [{ annee: 2025, ca: 0, resultat_net: 22710 }], ca: { annee: 2025, ca: 0, resultat_net: 22710 } };
  const v = controlerFiche(zero, MICRO, ctx);
  assert.equal(v.ca.statut, 'non_publie');
  assert.ok(v.drapeaux.includes('ca_non_publie'));
  assert.equal(v.statut, 'retenue');
  assert.ok(controlerFiche(n(20), BTP, ctx).drapeaux.includes('activite_nulle_declaree'));
});

test('G6, G7, G8, G9 : effectif non daté ou ancien, dirigeant de 101 ans, noms nominatifs, entreprise fermée', () => {
  assert.ok(controlerFiche(n(11), BTP, ctx).drapeaux.includes('effectif_non_date'));
  assert.ok(controlerFiche(n(13), BTP, ctx).drapeaux.includes('effectif_ancien'));
  assert.equal(controlerFiche(n(5), MICRO, ctx).statut, 'quarantaine');
  assert.ok(controlerFiche(n(1), MICRO, ctx).drapeaux.includes('nom_nominatif'), 'nom qui contient celui du dirigeant');
  assert.ok(controlerFiche(n(6), MICRO, ctx).drapeaux.includes('nom_nominatif'), 'entrepreneur individuel');
  assert.equal(controlerFiche(n(9), MICRO, ctx).statut, 'exclue');
});

test('G10 et comptes de liste : un doublon de SIREN est exclu, chaque contrôle est compté', () => {
  const L = controlerListe([n(14), n(15), n(14)], { complet: true }, MICRO, ctx);
  assert.equal(L.compte.retenues, 2);
  assert.equal(L.compte.exclues, 1);
  assert.equal(L.compte.par_controle.G10, 1);
  assert.equal(L.exclues[0].controle.statut, 'exclue');
});

test('règles apprises : appliquées après G1 à G11, champs et opérateurs fermés', () => {
  const regle = { code: 'R-NAF6209', champ: 'naf', op: 'in', valeur: ['62.09Z'], effet: 'quarantaine', motif: 'NAF à revoir à la main' };
  assert.equal(controlerFiche(n(14), MICRO, { ...ctx, regles: [regle] }).statut, 'retenue');
  assert.equal(controlerFiche({ ...n(14), naf: '62.09Z' }, MICRO, { ...ctx, regles: [regle] }).statut, 'quarantaine');
  assert.ok(compilerRegle({ ...regle, champ: 'ca.ca', op: '>', valeur: 1000, effet: 'drapeau' })(n(1)).touche);
  assert.throws(() => compilerRegle({ ...regle, champ: '__proto__' }), /refusée/);
  assert.throws(() => compilerRegle({ ...regle, effet: 'publier' }), /refusée/);
  assert.throws(() => compilerRegle({ ...regle, code: 'G4' }), /réservé/);
  assert.throws(() => compilerRegle({ ...regle, valeur: 'function () {}' }), /refusée/);
  const magasin = { lireJson: () => ({ regles: [regle, { ...regle, code: 'R-X', statut: 'candidate' }] }) };
  assert.deepEqual(chargerRegles(magasin).map((r) => r.code), ['R-NAF6209']);
});

test('L1 : lecture partielle et « 5 037 PME » sans « au moins » → bloquant', () => {
  const opts = { chiffres: { 'compte.retenues': 5037 }, lecture: { complet: false, lu_le: H.iso() }, horloge: H, codes: ['L1'] };
  const nu = controlerBrouillon(`Dans vos départements, ${(5037).toLocaleString('fr-FR')} PME actives.`, opts);
  assert.equal(nu.find((r) => r.code === 'L1').ok, false);
  assert.equal(controlerBrouillon('Dans vos départements, 5 037 PME actives.', opts).find((r) => r.code === 'L1').ok, false, 'espace ordinaire');
  const ok = controlerBrouillon(`Dans vos départements, au moins ${(5037).toLocaleString('fr-FR')} PME actives.`, opts);
  assert.equal(ok.find((r) => r.code === 'L1').ok, true);
});

test('L2, L4, L5 : partitions, quarantaine, champ opposition manquant (liste v1)', () => {
  const L2 = controlerListe([n(14)], { complet: true, total: 10, totaux_partition: { 75: 4, 92: 5 } }, MICRO, ctx).resultats.find((r) => r.code === 'L2');
  assert.equal(L2.ok, false);
  const L4 = controlerListe([n(5), n(2), n(14)], {}, MICRO, ctx).resultats.find((r) => r.code === 'L4');
  assert.equal(L4.ok, false);
  const v1 = [n(14), n(15)].map(({ opposition, ...e }) => e);
  const L = controlerListe(v1, {}, MICRO, ctx);
  assert.equal(L.resultats.find((r) => r.code === 'L5').ok, false);
  assert.equal(listeBloquee(L.resultats), true);
  assert.equal(listeBloquee(controlerListe([n(14), n(15)], {}, MICRO, ctx).resultats), false);
});

test('L3 : tirage reproductible ; 2 fiches fausses sur 10 → liste bloquée ; alias hors tirage → revue rejetée', () => {
  const a = echantillonControle(F, 'C-2026-11-15', 10), b = echantillonControle([...F].reverse(), 'C-2026-11-15', 10);
  assert.deepEqual(a.map((e) => e.siren), b.map((e) => e.siren), 'même liste, même graine, même tirage');
  assert.equal(new Set(a.map((e) => e.siren)).size, 10);
  assert.notDeepEqual(echantillonControle(F, 'autre graine', 10).map((e) => e.siren), a.map((e) => e.siren));
  const tires = a.map((e, i) => minimiser(e, H, null, { alias: `S${String(i + 1).padStart(2, '0')}` }));
  const revue = (fausses) => ({ fiches: tires.map((t, i) => ({ alias: t.alias, erreurs: i < fausses ? ['holding'] : [] })) });
  assert.equal(evaluerRevueEchantillon(revue(1), tires).ok, true);
  const deux = evaluerRevueEchantillon(revue(2), tires);
  assert.equal(deux.ok, false);
  assert.match(deux.motif, /bloquée/);
  const hors = revue(0); hors.fiches[0].alias = 'S99';
  assert.match(evaluerRevueEchantillon(hors, tires).motif, /hors du tirage/);
  assert.equal(evaluerRevueEchantillon({ fiches: revue(0).fiches.slice(1) }, tires).ok, false, 'revue incomplète');
  assert.equal(evaluerRevueEchantillon({ fiches: revue(0).fiches.map((f) => ({ ...f, erreurs: ['inventee'] })) }, tires).ok, false);
  const L3 = controlerListe(F, {}, TOUTES, { ...ctx, revue_echantillon: revue(2), tires }).resultats.find((r) => r.code === 'L3');
  assert.equal(L3.ok, false);
});

test('B1 et B2 : nombre sans provenance bloquant ; « 800 € HT » cité mot pour mot accepté ; « 450 € » hors citation bloquant', () => {
  const opts = { chiffres: { 'compte.retenues': 312 }, horloge: H, annonce: null, codes: ['B1', 'B2'],
    lecture: { complet: true, lu_le: H.iso() } };
  const r1 = controlerBrouillon(`Nous avons trouvé 1 200 entreprises.\n${PH}`, opts);
  assert.equal(r1.find((r) => r.code === 'B1').ok, false);
  const annonce = { description: 'Constituer une base de 150 entreprises du BTP, budget 800 € HT, livraison rapide.', statut: 'Ouvert', lu_le: H.iso() };
  const cite = controlerBrouillon(`Vous demandez « 150 entreprises du BTP » pour « 800 € HT » ; j’en ai trouvé 312.\n${PH}`, { ...opts, annonce });
  assert.equal(cite.find((r) => r.code === 'B1').ok, true);
  assert.equal(cite.find((r) => r.code === 'B2').ok, true);
  const prix = controlerBrouillon(`Je propose « 450 € » pour la liste.\n${PH}`, { ...opts, annonce });
  assert.equal(prix.find((r) => r.code === 'B2').ok, false);
  assert.equal(prix.find((r) => r.code === 'B1').ok, false);
  assert.equal(controlerBrouillon('Texte sans prix ni nom.', opts).find((r) => r.code === 'B2').ok, false, 'placeholders absents');
  const permis = controlerBrouillon(`Code NAF 43.22A, C. assurances, art. L241-1, RGPD art. 14 du RGPD, lu le 15/11/2026, créée en 2024.\n${PH}`, opts);
  assert.equal(permis.find((r) => r.code === 'B1').ok, true);
});

test('B3 à B6 : échantillon non retenu, lecture ancienne, annonce non relue, promesse', () => {
  const base = { horloge: H, chiffres: {}, lecture: { complet: true, lu_le: H.iso() } };
  assert.equal(controlerBrouillon('x', { ...base, codes: ['B3'], echantillon: [{ alias: 'S01', statut: 'retenue' }, { alias: 'S02', statut: 'quarantaine' }] })[0].ok, false);
  assert.equal(controlerBrouillon('x', { ...base, codes: ['B4'], lecture: { lu_le: '2026-11-07T08:00:00Z' } })[0].ok, false);
  assert.equal(controlerBrouillon('x', { ...base, codes: ['B4'] })[0].ok, true);
  assert.equal(controlerBrouillon('voir https://www.codeur.com/projects/1-x', { ...base, codes: ['B5'] })[0].ok, false, 'annonce liée jamais relue');
  assert.equal(controlerBrouillon('x', { ...base, codes: ['B5'], annonce: { statut: 'Fermé', lu_le: H.iso() } })[0].ok, false);
  assert.equal(controlerBrouillon('x', { ...base, codes: ['B5'], annonce: { statut: 'Ouvert', lu_le: '2026-11-14T08:00:00Z' } })[0].ok, false, 'lue il y a plus de 24 h');
  assert.equal(controlerBrouillon('x', { ...base, codes: ['B5'], annonce: { statut: 'Ouvert', lu_le: H.iso() } })[0].ok, true);
  for (const mot of ['résultat garanti', 'qualité assurée', 'données 100 % à jour', 'fichier exhaustif', 'accès illimité', 'sans risque']) {
    assert.equal(controlerBrouillon(mot, { ...base, codes: ['B6'] })[0].ok, false, mot);
  }
  assert.equal(controlerBrouillon('la garantie décennale, la garantie d’achèvement et vos assurés', { ...base, codes: ['B6'] })[0].ok, true);
});

test('B7 : canari détecté sans jamais être affiché ; dictionnaire absent → échec fermé', () => {
  const dict = jetonsDe(F);
  const r = controlerBrouillon('Le gérant Zéphyrin CANARIX vous attend.', { horloge: H, dict, codes: ['B7'] })[0];
  assert.equal(r.ok, false);
  assert.doesNotMatch(JSON.stringify(r), /CANARIX|Zéphyrin/i);
  assert.equal(controlerBrouillon('Bonjour.', { horloge: H, dict, codes: ['B7'] })[0].ok, true);
  assert.equal(controlerBrouillon('Bonjour.', { horloge: H, codes: ['B7'] })[0].ok, false);
  assert.equal(controlerBrouillon('Bonjour.', { horloge: H, dict: { jetons: new Set() }, codes: ['B7'] })[0].ok, false);
  for (const fuite of ['SIREN 999 000 012', ['tél. 06 12', '34 56 78'].join(' '), `écrire à contact${'@'}exemple.fr`]) assert.ok(scannerTexte(fuite, dict).n > 0, fuite);
});

test('B8 : un total brut de sonde n’apparaît que dans une phrase qui contient « brut »', () => {
  const opts = { horloge: H, chiffres: { 'sonde.total_brut': 6778 }, codes: ['B8'] };
  assert.equal(controlerBrouillon(`Le registre renvoie un total brut de ${(6778).toLocaleString('fr-FR')} entreprises.`, opts)[0].ok, true);
  assert.equal(controlerBrouillon(`Le registre compte ${(6778).toLocaleString('fr-FR')} entreprises. Ce total est brut.`, opts)[0].ok, false);
});

test('minimiser : ni nom de dirigeant, ni année de naissance, nom et commune masqués pour une EI ou un nom nominatif', () => {
  const m = minimiser(n(1), H, jetonsDe(F), { alias: 'S01' });
  const json = JSON.stringify(m);
  assert.equal(m.nom_affichable, null);
  assert.equal(m.commune, null);
  assert.equal(m.dirigeant.tranche_age, '62 ans ou plus');
  assert.doesNotMatch(json, /CANARIX|Zéphyrin|1958|annee_naissance/i);
  assert.equal(minimiser(n(6), H).nom_affichable, null, 'EI');
  assert.equal(minimiser(n(15), H).dirigeant.tranche_age, 'moins de 62 ans');
  assert.equal(minimiser(n(15), H).nom_affichable, 'JEUNEDEV STUDIO');
});

// ---------------------------------------------------------------------------------------------------------------------
// Contrôle local sur les listes réelles du 15/11 (prive/, jamais en CI). N'affiche que des comptes.

const PRIVE = fileURLToPath(new URL('../prive/', import.meta.url));
const IT_BRUT = `${PRIVE}rachat-it-idf-2026-11-15.brut.json`, BTP_LISTE = `${PRIVE}courtier-btp-aura-2026-11-15.json`;

test('local : liste IT du 15/11 → 862 dans la recette, 694 après G4 (312 portefeuille, 151 rentable) ; G7 touche 1 fiche', { skip: !fs.existsSync(IT_BRUT) && 'prive/ absent' }, async () => {
  const { resumer } = await import('../src/sources/sirene.js');
  const { RECETTES, compiler, appliquer } = await import('../src/recettes.js');
  const brut = JSON.parse(fs.readFileSync(IT_BRUT, 'utf8'));
  const fiches = brut.fiches.map((f) => {
    const e = resumer(f);
    // Repli si sources/sirene.js n'expose pas encore les champs v2 (la fiche brute les porte).
    return e.opposition === undefined ? { ...e, opposition: Boolean(f.opposition_diffusion_commerciale), nature_juridique: f.nature_juridique, fermee: f.etat_administratif !== 'A', dirigeants_pm: (f.dirigeants ?? []).filter((d) => d.type_dirigeant === 'personne morale' && !/commissaire/i.test(d.qualite ?? '')).length, statut_diffusion: f.statut_diffusion } : e;
  });
  const r = compiler(RECETTES['rachat-it-idf'].spec, H);
  const { compte } = appliquer(r, fiches, { horloge: H, oppositions: new Set(), lecture: { complet: brut.complet, total: brut.total } });
  assert.equal(compte.lues, 1111);
  assert.equal(compte.controlees, 862, 'périmètre de la recette = retenues v1');
  assert.equal(compte.par_controle.G4, 168);
  assert.equal(compte.retenues, 694);
  assert.equal(compte.par_signal.portefeuille, 312);
  assert.equal(compte.par_signal.rentable, 151);
  assert.equal(compte.par_controle.G7, 1, 'le dirigeant de 101 ans (fiche opposée, donc exclue de toute façon)');
  // 20 fiches à dirigeant personne morale avec sirene.resumer, qui écarte les commissaires aux comptes ; la critique
  // en comptait 33 en les incluant.
  assert.equal(compte.par_drapeau.filiale_probable, 20);
});

test('local : BTP du 15/11 → 1 119 complètes v1, 864 après G2 ; ratio G1 sur 9 fiches, les 4 promoteurs 41.10A non touchés', { skip: !fs.existsSync(BTP_LISTE) && 'prive/ absent' }, async () => {
  const { RECETTES, compiler } = await import('../src/recettes.js');
  const liste = JSON.parse(fs.readFileSync(BTP_LISTE, 'utf8'));
  const r = compiler(RECETTES['courtier-btp-aura'].spec, H);
  assert.equal(liste.cibles.filter((e) => e.complet).length, 1119);
  assert.equal(liste.cibles.filter((e) => e.complet && r.complet(e) && controlerFiche(e, r, ctx).ca.statut !== 'ancien').length, 864);
  const borne = { '6-9': 9, '10-19': 19, '20-49': 49, '50-99': 99 };
  const eleves = liste.cibles.filter((e) => e.ca?.ca / borne[e.effectif] > 1e6);
  assert.equal(eleves.length, 9);
  const promoteurs = eleves.filter((e) => e.naf === '41.10A');
  assert.equal(promoteurs.length, 4);
  for (const e of promoteurs) assert.ok(!controlerFiche(e, r, ctx).drapeaux.includes('ca_par_salarie_eleve'));
  assert.equal(eleves.filter((e) => controlerFiche(e, r, ctx).drapeaux.includes('ca_par_salarie_eleve')).length, 5);
});
